import { mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import os from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";

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
function resolveAgentSkillsDir(agent: AgentDefinition, opts: InstallOptions): string {
  if (opts.global) {
    return expandTilde(agent.globalSkillsDir);
  }
  return join(opts.projectRoot, agent.localSkillsDir);
}

export function ensureCanonicalDir(base: string, global: boolean): string {
  if (global) {
    const dir = join(os.homedir(), ".agents", "skills");
    mkdirSync(dir, { recursive: true });
    return dir;
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
 * Install a skill using the canonical symlink approach:
 * 1. Write SKILL.md to .agents/skills/{name}/ (canonical source of truth)
 * 2. Create relative symlinks from each agent dir to the canonical dir
 * 3. For agents with known symlink issues, fall back to direct copy
 */
export function installSymlink(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
): string[] {
  const canonicalSkillDir = join(ensureCanonicalDir(opts.projectRoot, opts.global), skillName);
  mkdirSync(canonicalSkillDir, { recursive: true });
  writeFileSync(join(canonicalSkillDir, "SKILL.md"), content);

  const installed: string[] = [];

  for (const agent of agents) {
    const agentSkillsDir = resolveAgentSkillsDir(agent, opts);
    mkdirSync(agentSkillsDir, { recursive: true });

    const linkPath = join(agentSkillsDir, skillName);

    // Agents with known symlink issues get direct copy
    if (COPY_FALLBACK_AGENTS.has(agent.id)) {
      mkdirSync(linkPath, { recursive: true });
      writeFileSync(join(linkPath, "SKILL.md"), content);
      installed.push(linkPath);
      continue;
    }

    const ok = createRelativeSymlink(canonicalSkillDir, linkPath);

    if (ok) {
      installed.push(linkPath);
    } else {
      // Fallback to copy on symlink failure
      mkdirSync(linkPath, { recursive: true });
      writeFileSync(join(linkPath, "SKILL.md"), content);
      installed.push(linkPath);
    }
  }

  return installed;
}

/**
 * Install a skill by copying SKILL.md directly to each agent directory.
 */
export function installCopy(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
): string[] {
  const installed: string[] = [];

  for (const agent of agents) {
    const agentSkillsDir = resolveAgentSkillsDir(agent, opts);
    const skillDir = join(agentSkillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
    installed.push(skillDir);
  }

  return installed;
}
