import { mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync } from "node:fs";
// 0706 T-004: `relative` + `sep` (as pathSep) power the cross-platform
// path-traversal guard. `path.relative` handles Windows backslash correctly.
import { join, relative, dirname, sep as pathSep } from "node:path";
import os from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { resolveTilde } from "../utils/paths.js";
import { ensureFrontmatter, stripClaudeFields } from "./frontmatter.js";
import { resolveBundleTarget } from "./bundle-files.js";

export interface InstallOptions {
  global: boolean;
  projectRoot: string;
}

/**
 * 0845 T-002 (AC-US3-03): per-agent env-var overrides for global skills dirs.
 *
 * Only Antigravity is wired today (`VSKILL_ANTIGRAVITY_SKILLS_DIR`); the table
 * structure is reusable when future agents need an analogous escape hatch.
 * Returns null when no override applies so callers fall back to the
 * registry-declared `globalSkillsDir`.
 */
export function resolveGlobalSkillsDirEnvOverride(agent: AgentDefinition): string | null {
  if (agent.id === "antigravity") {
    const override = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
    if (override && override.trim().length > 0) return override.trim();
  }
  return null;
}

/**
 * Resolve the skills directory for an agent given the install scope.
 *
 * Global: uses agent.globalSkillsDir (e.g. ~/.claude/skills)
 *         Honors per-agent env-var overrides via
 *         `resolveGlobalSkillsDirEnvOverride()` — currently
 *         `VSKILL_ANTIGRAVITY_SKILLS_DIR` for Antigravity.
 * Local:  uses projectRoot + agent.localSkillsDir (e.g. ./project/.claude/skills)
 */
export function resolveAgentSkillsDir(agent: AgentDefinition, opts: InstallOptions): string {
  if (opts.global) {
    const override = resolveGlobalSkillsDirEnvOverride(agent);
    if (override) return override;
    return resolveTilde(agent.globalSkillsDir);
  }
  const resolved = join(opts.projectRoot, agent.localSkillsDir);
  const normalizedRoot = join(opts.projectRoot, ".");
  // 0706 T-004: switch from `resolved.startsWith(normalizedRoot + "/")` to
  // `path.relative()`. The old check hardcoded `/` as the separator, which
  // false-positives on Windows where `path.join` emits `\`. `path.relative`
  // returns a path starting with `..` iff the target escapes the base —
  // works correctly on POSIX and win32 without separator juggling.
  const rel = relative(normalizedRoot, resolved);
  if (resolved !== normalizedRoot && (rel === ".." || rel.startsWith(".." + pathSep) || rel.startsWith("../"))) {
    throw new Error(
      `Path traversal detected: ${agent.localSkillsDir} resolves above project root ${opts.projectRoot}`,
    );
  }
  return resolved;
}

export function ensureCanonicalDir(base: string, global: boolean): string {
  if (global) {
    const dir = join(os.homedir(), ".agents", "skills");
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (base === os.homedir()) {
    throw new Error(
      "Refusing to create .agents/ directory in home directory for project-scoped install",
    );
  }
  const dir = join(base, ".agents", "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 0706 T-006: module-scoped flag so we only warn once per process about
 * missing symlink permissions (Windows without Developer Mode / without
 * Administrator). Exported `__resetSymlinkWarning` is for tests only.
 */
let warnedAboutSymlinkFallback = false;

/** Test-only helper to reset the module-scoped symlink-warning flag. */
export function __resetSymlinkWarning(): void {
  warnedAboutSymlinkFallback = false;
}

export function createRelativeSymlink(target: string, linkPath: string): boolean {
  try {
    const relTarget = relative(dirname(linkPath), target);
    // Remove existing symlink/dir at linkPath
    try {
      const stat = lstatSync(linkPath);
      if (stat.isSymbolicLink() || stat.isDirectory()) {
        rmSync(linkPath, { recursive: true, force: true });
      }
    } catch {
      // Does not exist, fine
    }
    symlinkSync(relTarget, linkPath, "dir");
    return true;
  } catch (err: any) {
    // 0706 T-006: warn ONCE per process when we hit a permission-related
    // symlink failure (Windows without Developer Mode / Administrator) —
    // before, the error was silent, which made the Windows fallback
    // invisible to users. For any other failure we preserve the prior
    // contract (return false and let the caller copy) so pre-existing
    // installs and tests keep working; only the user-facing diagnostics
    // change here.
    if (
      (err?.code === "EPERM" || err?.code === "EACCES") &&
      !warnedAboutSymlinkFallback
    ) {
      console.error(
        "Symlinks not available — copying files (enable Developer Mode to use symlinks)",
      );
      warnedAboutSymlinkFallback = true;
    }
    return false;
  }
}

/**
 * Agents known to have unreliable symlink support.
 * These always get a direct copy even in symlink mode.
 * See: https://github.com/anthropics/claude-code/issues/14836
 */
const COPY_FALLBACK_AGENTS = new Set(["claude-code"]);

/**
 * Write agent files (agents/*.md) alongside SKILL.md in a target directory.
 * Keys are relative paths (e.g., "agents/frontend.md"), values are file contents.
 */
function writeAgentFiles(targetDir: string, agentFiles: Record<string, string>): void {
  for (const [relPath, fileContent] of Object.entries(agentFiles)) {
    const fullPath = resolveBundleTarget(targetDir, relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, fileContent);
  }
}

/**
 * Install a skill using the canonical symlink approach:
 * 1. Write SKILL.md to .agents/skills/{name}/ (canonical source of truth)
 * 2. Create relative symlinks from each agent dir to the canonical dir
 * 3. For agents with known symlink issues, fall back to direct copy
 *
 * Optional agentFiles: additional files (e.g., agents/*.md) to install alongside SKILL.md.
 * Keys are relative paths within the skill directory.
 */
export function installSymlink(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
  agentFiles?: Record<string, string>,
): string[] {
  content = ensureFrontmatter(content, skillName);
  const strippedContent = stripClaudeFields(content, skillName);

  // Skip canonical .agents/ dir when all agents use copy-fallback (e.g., claude-code only)
  const needsCanonical = agents.some(a => !COPY_FALLBACK_AGENTS.has(a.id));

  let canonicalSkillDir: string | undefined;
  if (needsCanonical) {
    canonicalSkillDir = join(ensureCanonicalDir(opts.projectRoot, opts.global), skillName);
    mkdirSync(canonicalSkillDir, { recursive: true });
    writeFileSync(join(canonicalSkillDir, "SKILL.md"), strippedContent);
    if (agentFiles) writeAgentFiles(canonicalSkillDir, agentFiles);
  }

  const installed: string[] = [];

  for (const agent of agents) {
    const agentSkillsDir = resolveAgentSkillsDir(agent, opts);
    mkdirSync(agentSkillsDir, { recursive: true });

    const linkPath = join(agentSkillsDir, skillName);

    // Agents with known symlink issues get direct copy
    if (COPY_FALLBACK_AGENTS.has(agent.id)) {
      // Claude Code gets full content with all fields
      const agentContent = agent.id === "claude-code" ? content : strippedContent;
      mkdirSync(linkPath, { recursive: true });
      writeFileSync(join(linkPath, "SKILL.md"), agentContent);
      if (agentFiles) writeAgentFiles(linkPath, agentFiles);
      installed.push(linkPath);
      continue;
    }

    const ok = createRelativeSymlink(canonicalSkillDir!, linkPath);

    if (ok) {
      installed.push(linkPath);
    } else {
      // Fallback to copy on symlink failure — use stripped content for non-Claude
      mkdirSync(linkPath, { recursive: true });
      writeFileSync(join(linkPath, "SKILL.md"), strippedContent);
      if (agentFiles) writeAgentFiles(linkPath, agentFiles);
      installed.push(linkPath);
    }
  }

  return installed;
}

/**
 * Install a skill by copying SKILL.md directly to each agent directory.
 *
 * Optional agentFiles: additional files (e.g., agents/*.md) to install alongside SKILL.md.
 */
export function installCopy(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
  agentFiles?: Record<string, string>,
): string[] {
  content = ensureFrontmatter(content, skillName);
  const strippedContent = stripClaudeFields(content, skillName);
  const installed: string[] = [];

  for (const agent of agents) {
    // Claude Code gets full content; all others get stripped
    const agentContent = agent.id === "claude-code" ? content : strippedContent;
    const agentSkillsDir = resolveAgentSkillsDir(agent, opts);
    const skillDir = join(agentSkillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), agentContent);
    if (agentFiles) writeAgentFiles(skillDir, agentFiles);
    installed.push(skillDir);
  }

  return installed;
}

/**
 * 0845 T-012/T-014: Resolve the Tier-2 INSTALL ROOT for an agent —
 * the parent of `localSkillsDir` / `globalSkillsDir`. Tier-2 transformers
 * emit relative paths that include their own subfolder layout (e.g.
 * `rules/<name>.mdc` for Cursor), so the dispatcher joins those onto
 * this root rather than onto the skills dir itself.
 *
 * Win32 (T-014, AC-US4-12): when `process.platform === "win32"` and the
 * agent declares `win32PathOverride`, that path is the install root
 * directly (no parent traversal). On POSIX hosts the override is ignored
 * — agents continue to honor `globalSkillsDir`'s tilde-expanded form.
 *
 * Project-scope (`global: false`) keeps the existing path-traversal
 * guard via `resolveAgentSkillsDir` so projects can't escape via a
 * crafted `localSkillsDir`. The returned root for project-scope is the
 * parent of the resolved skills dir, with the same traversal protection
 * already in force.
 */
export function resolveAgentInstallRoot(
  agent: AgentDefinition,
  opts: InstallOptions,
): string {
  if (opts.global && process.platform === "win32" && agent.win32PathOverride) {
    return agent.win32PathOverride;
  }
  // Reuse `resolveAgentSkillsDir` so env overrides + project-traversal
  // guards stay in one place. Then climb one level to the install root.
  const skillsDir = resolveAgentSkillsDir(agent, opts);
  return dirname(skillsDir);
}
