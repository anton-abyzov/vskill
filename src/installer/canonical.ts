import { mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import os from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { ensureFrontmatter, stripClaudeFields } from "./frontmatter.js";

/**
 * Filter agents by target-agents frontmatter.
 * When targetAgents is undefined or empty, returns all agents (existing behavior).
 * When targetAgents is specified, returns only agents whose IDs are in the list.
 */
export function filterAgentsByTargetAgents(
  agents: AgentDefinition[],
  targetAgents: string[] | undefined,
): AgentDefinition[] {
  if (!targetAgents || targetAgents.length === 0) return agents;
  const targetSet = new Set(targetAgents);
  return agents.filter((a) => targetSet.has(a.id));
}

export interface InstallOptions {
  global: boolean;
  projectRoot: string;
}

/**
 * Resolve tilde in a path to the user's home directory.
 */
function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return os.homedir() + p.slice(1);
  return p;
}

/**
 * Resolve the skills directory for an agent given the install scope.
 *
 * Global: uses agent.globalSkillsDir (e.g. ~/.claude/skills)
 * Local:  uses projectRoot + agent.localSkillsDir (e.g. ./project/.claude/skills)
 */
export function resolveAgentSkillsDir(agent: AgentDefinition, opts: InstallOptions): string {
  if (opts.global) {
    return expandTilde(agent.globalSkillsDir);
  }
  const resolved = join(opts.projectRoot, agent.localSkillsDir);
  const normalizedRoot = join(opts.projectRoot, ".");
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + "/")) {
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
  } catch {
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
  const resolvedTarget = join(targetDir, "."); // normalize
  for (const [relPath, fileContent] of Object.entries(agentFiles)) {
    const fullPath = join(resolvedTarget, relPath);
    if (!fullPath.startsWith(resolvedTarget)) continue; // path traversal guard
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
