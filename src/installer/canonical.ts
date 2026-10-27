import { mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync, existsSync, unlinkSync, chmodSync, readdirSync, rmdirSync } from "node:fs";
// 0706 T-004: `relative` + `sep` (as pathSep) power the cross-platform
// path-traversal guard. `path.relative` handles Windows backslash correctly.
import { join, relative, dirname, resolve, sep as pathSep } from "node:path";
import os from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { resolveTilde } from "../utils/paths.js";
import { ensureFrontmatter, stripClaudeFields } from "./frontmatter.js";
import { resolveBundleTarget, type BundleContent } from "./bundle-files.js";

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
    // 0894: Antigravity's registry default is ~/.gemini/config/skills, but an
    // existing legacy IDE dir ~/.gemini/antigravity/skills keeps priority so
    // installs land where that setup already loads skills from.
    if (agent.id === "antigravity") {
      const legacy = resolveTilde("~/.gemini/antigravity/skills");
      if (existsSync(legacy)) return legacy;
    }
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

/** 0894: path of the shared canonical skills folder for a scope, without
 *  creating it (`~/.agents/skills` or `<projectRoot>/.agents/skills`). */
export function resolveCanonicalSkillsDir(opts: InstallOptions): string {
  return opts.global
    ? join(os.homedir(), ".agents", "skills")
    : join(opts.projectRoot, ".agents", "skills");
}

/** 0894: true when the agent is satisfied by the canonical folder in this
 *  scope — it reads the shared `.agents/skills`, so vskill writes no
 *  agent-specific link or copy for it. */
export function isSatisfiedByCanonical(agent: AgentDefinition, opts: InstallOptions): boolean {
  // Read the flag directly (not via a registry helper) so callers that mock
  // the registry module keep working.
  return agent.readsSharedSkills?.[opts.global ? "global" : "project"] === true;
}

/** 0894: the folder an agent actually loads a skill from in this scope —
 *  the shared canonical folder for shared readers, else its own skills dir. */
export function resolveEffectiveSkillsDir(agent: AgentDefinition, opts: InstallOptions): string {
  return isSatisfiedByCanonical(agent, opts)
    ? resolveCanonicalSkillsDir(opts)
    : resolveAgentSkillsDir(agent, opts);
}

export function ensureCanonicalDir(base: string, global: boolean): string {
  if (global) {
    const dir = join(os.homedir(), ".agents", "skills");
    assertSafeInstallParent(dir, { global, projectRoot: base });
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  if (base === os.homedir()) {
    throw new Error(
      "Refusing to create .agents/ directory in home directory for project-scoped install",
    );
  }
  const dir = join(base, ".agents", "skills");
  assertSafeInstallParent(dir, { global, projectRoot: base });
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
 * Agents that keep a full copy when their content differs from the shared
 * canonical copy. Claude Code is the only one: it reads Claude-only
 * frontmatter (allowed-tools, model, context, ...) that the canonical copy
 * strips. When nothing is stripped, Claude Code gets a link like everyone
 * else (0894; current Claude Code follows symlinked skill folders, the old
 * https://github.com/anthropics/claude-code/issues/14836 no longer applies).
 */
const COPY_FALLBACK_AGENTS = new Set(["claude-code"]);

/** 0894: how a skill bundle is written over a previous install. */
export interface BundleWriteOptions {
  /**
   * Paths written with mode 0755 (git mode 100755 upstream). When given,
   * every other bundled file is set to 0644; when absent, modes are left as
   * the filesystem makes them (an existing file keeps its mode).
   */
  executables?: ReadonlySet<string>;
  /**
   * Accept any relative path inside the skill folder. Only for a complete
   * skill tree fetched from the skill's own GitHub folder; every other caller
   * (Studio, `vskill update`) keeps the standard-folder policy.
   */
  anyPath?: boolean;
  /**
   * Files the previous install of this skill recorded (lockfile `files`).
   * Those the new bundle no longer has are removed, so a reinstall leaves no
   * orphans. Files the previous install did not record (Studio evals, user
   * notes) are never touched.
   */
  previousFiles?: readonly string[];
  /** Each independent agent copy can still contain an older version's files. */
  previousFilesByAgent?: Readonly<Record<string, readonly string[]>>;
}

function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}

/** Parent configuration folders are shared with other skills: reject links
 * rather than replacing them. The selected project/home is the trust root. */
function assertSafeInstallParent(dir: string, opts: InstallOptions): void {
  const trustedRoot = resolve(opts.global ? os.homedir() : opts.projectRoot);
  const target = resolve(dir);
  const rel = relative(trustedRoot, target);
  // A global directory explicitly configured outside HOME is itself a trusted
  // install location; still reject a symlink at that selected directory.
  const outside = rel === ".." || rel.startsWith(".." + pathSep);
  let cur = outside ? dirname(target) : trustedRoot;
  const parts = outside ? [relative(dirname(target), target)] : rel.split(pathSep).filter(Boolean);
  for (const part of parts) {
    cur = join(cur, part);
    const st = lstatOrNull(cur);
    if (!st) break;
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`Refusing to install through an unsafe parent directory: ${cur}`);
  }
}

function prepareSkillDirectory(dir: string): void {
  const st = lstatOrNull(dir);
  if (st && !st.isDirectory()) unlinkSync(dir);
  mkdirSync(dir, { recursive: true });
}

function writeSkillMd(dir: string, content: string): void {
  const file = join(dir, "SKILL.md");
  clearPathForFile(dir, file);
  writeFileSync(file, content);
}

function bundleOptionsForAgents(opts: BundleWriteOptions | undefined, agentIds: string[]): BundleWriteOptions | undefined {
  if (!opts?.previousFilesByAgent) return opts;
  return { ...opts, previousFiles: [...new Set(agentIds.flatMap((id) => opts.previousFilesByAgent?.[id] ?? opts.previousFiles ?? []))] };
}

/** Remove now-empty folders from `dir` up to (not including) `root`. */
function pruneEmptyDirs(dir: string, root: string): void {
  let cur = dir;
  while (cur !== root && relative(root, cur) && !relative(root, cur).startsWith("..")) {
    try {
      const st = lstatOrNull(cur);
      if (!st?.isDirectory() || st.isSymbolicLink() || readdirSync(cur).length > 0) return;
      rmdirSync(cur);
    } catch {
      return;
    }
    cur = dirname(cur);
  }
}

/**
 * Make `fullPath` writable as a regular file inside `root`: an ancestor that
 * is a file or a symlink (which could also point outside the skill folder) is
 * removed, and a folder sitting where the file goes is removed. Without this,
 * a reinstall whose tree changed shape dies half-written with EISDIR/ENOTDIR.
 */
function clearPathForFile(root: string, fullPath: string): void {
  const parts = relative(root, dirname(fullPath)).split(pathSep).filter(Boolean);
  let cur = root;
  for (const part of parts) {
    cur = join(cur, part);
    const st = lstatOrNull(cur);
    if (!st) break;
    if (!st.isDirectory()) unlinkSync(cur);
  }
  const st = lstatOrNull(fullPath);
  if (st?.isDirectory()) rmSync(fullPath, { recursive: true, force: true });
  else if (st?.isSymbolicLink() || (st?.isFile() && st.nlink > 1)) unlinkSync(fullPath);
}

/**
 * Write bundled files alongside SKILL.md in a target directory.
 * Keys are relative paths (e.g., "agents/frontend.md", "assets/font.woff2");
 * values are text or raw bytes, written as-is. Paths were policy-checked when
 * the bundle entered the installer, so only traversal is re-checked here.
 */
function writeAgentFiles(
  targetDir: string,
  agentFiles: Record<string, BundleContent> | undefined,
  bundleOpts?: BundleWriteOptions,
): void {
  if (!lstatOrNull(targetDir)?.isDirectory()) throw new Error("Skill directory must be a real directory before writing files");
  const files = agentFiles ?? {};
  if (bundleOpts?.previousFiles) {
    const keep = new Set(Object.keys(files));
    for (const rel of bundleOpts.previousFiles) {
      if (rel === "SKILL.md" || keep.has(rel)) continue;
      let target: string;
      try {
        target = resolveBundleTarget(targetDir, rel, { anyPath: true });
      } catch {
        continue; // never act on an unsafe recorded path
      }
      // Never lstat/unlink a stale leaf through a symlinked ancestor. Drop
      // only the in-skill link; its destination belongs to someone else.
      let parent = targetDir;
      let safe = true;
      for (const part of relative(targetDir, dirname(target)).split(pathSep).filter(Boolean)) {
        parent = join(parent, part);
        const parentStat = lstatOrNull(parent);
        if (parentStat?.isSymbolicLink()) { unlinkSync(parent); safe = false; break; }
        if (!parentStat?.isDirectory()) { safe = false; break; }
      }
      if (!safe) continue;
      const st = lstatOrNull(target);
      if (st && !st.isDirectory()) {
        unlinkSync(target);
        pruneEmptyDirs(dirname(target), targetDir);
      }
    }
  }
  const anyPath = bundleOpts?.anyPath === true;
  const executables = bundleOpts?.executables;
  for (const [relPath, fileContent] of Object.entries(files)) {
    const fullPath = resolveBundleTarget(targetDir, relPath, { anyPath });
    clearPathForFile(targetDir, fullPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, fileContent);
    // Explicit when the caller knows the modes: writeFileSync keeps the old
    // mode of an existing file, so a dropped exec bit would otherwise stick.
    if (executables) chmodSync(fullPath, executables.has(relPath) ? 0o755 : 0o644);
  }
}

/**
 * `name:` must equal the folder an agent reads: Codex and the Agent Skills
 * spec ignore a namespaced `plugin/skill` name or one that differs from the
 * folder. A matching name is left untouched (no-touch principle).
 */
function folderName(skillName: string): string {
  return skillName.split("/").pop() || skillName;
}

/**
 * Install a skill using the canonical symlink approach:
 * 1. Write SKILL.md to .agents/skills/{name}/ (canonical source of truth)
 * 2. Agents that read the shared .agents/skills in this scope (0894) get
 *    nothing else — the canonical folder is what they load
 * 3. Create relative symlinks from every other agent dir to the canonical dir
 * 4. For agents with known symlink issues, fall back to direct copy
 *
 * Optional agentFiles: additional files (e.g., agents/*.md) to install alongside SKILL.md.
 * Keys are relative paths within the skill directory.
 */
export function installSymlink(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
  agentFiles?: Record<string, BundleContent>,
  bundleOpts?: BundleWriteOptions,
): string[] {
  content = ensureFrontmatter(content, folderName(skillName), true);
  const strippedContent = stripClaudeFields(content, skillName);

  // Skip canonical .agents/ dir when all agents use copy-fallback (e.g., claude-code only)
  const needsCanonical = agents.some(a => !COPY_FALLBACK_AGENTS.has(a.id));

  let canonicalSkillDir: string | undefined;
  if (needsCanonical) {
    canonicalSkillDir = join(ensureCanonicalDir(opts.projectRoot, opts.global), skillName);
    prepareSkillDirectory(canonicalSkillDir);
    writeSkillMd(canonicalSkillDir, strippedContent);
    writeAgentFiles(canonicalSkillDir, agentFiles, bundleOptionsForAgents(bundleOpts, agents.filter((agent) => !COPY_FALLBACK_AGENTS.has(agent.id)).map((agent) => agent.id)));
  }

  const installed: string[] = [];

  for (const agent of agents) {
    // 0894 (AC-04): shared readers load the canonical folder directly.
    if (isSatisfiedByCanonical(agent, opts) && canonicalSkillDir) {
      if (!installed.includes(canonicalSkillDir)) installed.push(canonicalSkillDir);
      continue;
    }

    const agentSkillsDir = resolveAgentSkillsDir(agent, opts);
    const linkPath = join(agentSkillsDir, skillName);

    // Never link the canonical folder onto itself (an agent whose skills dir
    // IS the shared folder); removing the "existing" path would delete it.
    if (canonicalSkillDir && linkPath === canonicalSkillDir) {
      if (!installed.includes(canonicalSkillDir)) installed.push(canonicalSkillDir);
      continue;
    }

    assertSafeInstallParent(agentSkillsDir, opts);
    mkdirSync(agentSkillsDir, { recursive: true });

    // Claude Code links to the canonical copy when that copy is exactly what
    // Claude would get; otherwise it keeps a full copy with its own fields.
    if (
      COPY_FALLBACK_AGENTS.has(agent.id) &&
      canonicalSkillDir &&
      strippedContent === content &&
      createRelativeSymlink(canonicalSkillDir, linkPath)
    ) {
      installed.push(linkPath);
      continue;
    }
    if (COPY_FALLBACK_AGENTS.has(agent.id)) {
      // Claude Code gets full content with all fields
      const agentContent = agent.id === "claude-code" ? content : strippedContent;
      prepareSkillDirectory(linkPath);
      writeSkillMd(linkPath, agentContent);
      writeAgentFiles(linkPath, agentFiles, bundleOptionsForAgents(bundleOpts, [agent.id]));
      installed.push(linkPath);
      continue;
    }

    const ok = createRelativeSymlink(canonicalSkillDir!, linkPath);

    if (ok) {
      installed.push(linkPath);
    } else {
      // Fallback to copy on symlink failure — use stripped content for non-Claude
      prepareSkillDirectory(linkPath);
      writeSkillMd(linkPath, strippedContent);
      writeAgentFiles(linkPath, agentFiles, bundleOptionsForAgents(bundleOpts, [agent.id]));
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
  agentFiles?: Record<string, BundleContent>,
  bundleOpts?: BundleWriteOptions,
): string[] {
  content = ensureFrontmatter(content, folderName(skillName), true);
  const strippedContent = stripClaudeFields(content, skillName);
  const installed: string[] = [];

  for (const agent of agents) {
    // Claude Code gets full content; all others get stripped
    const agentContent = agent.id === "claude-code" ? content : strippedContent;
    // 0894 (AC-04): shared readers get one copy in the canonical folder
    // instead of a per-agent copy.
    const agentSkillsDir = isSatisfiedByCanonical(agent, opts)
      ? ensureCanonicalDir(opts.projectRoot, opts.global)
      : resolveAgentSkillsDir(agent, opts);
    const skillDir = join(agentSkillsDir, skillName);
    if (installed.includes(skillDir)) continue;
    // No skill-level link may redirect a copy, including a shared reader's
    // canonical skill folder. Shared parent directories are checked first.
    assertSafeInstallParent(agentSkillsDir, opts);
    prepareSkillDirectory(skillDir);
    writeSkillMd(skillDir, agentContent);
    const sharing = agents.filter((other) => resolveEffectiveSkillsDir(other, opts) === agentSkillsDir).map((other) => other.id);
    writeAgentFiles(skillDir, agentFiles, bundleOptionsForAgents(bundleOpts, sharing));
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
  // F7: explicit project-scope root override for agents whose tool reads
  // transformed output from a directory that is NOT the parent of
  // `localSkillsDir` (github-copilot-ext: VS Code reads
  // `.github/instructions/`, but localSkillsDir is `.github/copilot/skills`).
  // Same path-traversal guard as `resolveAgentSkillsDir`.
  if (!opts.global && agent.localInstallRoot) {
    const resolved = join(opts.projectRoot, agent.localInstallRoot);
    const normalizedRoot = join(opts.projectRoot, ".");
    const rel = relative(normalizedRoot, resolved);
    if (rel === ".." || rel.startsWith(".." + pathSep) || rel.startsWith("../")) {
      throw new Error(
        `Path traversal detected: ${agent.localInstallRoot} resolves above project root ${opts.projectRoot}`,
      );
    }
    return resolved;
  }
  // Reuse `resolveAgentSkillsDir` so env overrides + project-traversal
  // guards stay in one place. Then climb one level to the install root.
  const skillsDir = resolveAgentSkillsDir(agent, opts);
  return dirname(skillsDir);
}
