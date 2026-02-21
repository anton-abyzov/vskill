import { mkdirSync, writeFileSync, symlinkSync, lstatSync, rmSync, readlinkSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type { AgentDefinition } from "../agents/agents-registry.js";

export interface InstallOptions {
  global: boolean;
  projectRoot: string;
}

export function ensureCanonicalDir(base: string): string {
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

export function installSymlink(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
): string[] {
  const base = opts.projectRoot;
  const canonicalSkillDir = join(ensureCanonicalDir(base), skillName);
  mkdirSync(canonicalSkillDir, { recursive: true });
  writeFileSync(join(canonicalSkillDir, "SKILL.md"), content);

  const installed: string[] = [];

  for (const agent of agents) {
    const agentSkillsDir = join(base, agent.localSkillsDir);
    mkdirSync(agentSkillsDir, { recursive: true });

    const linkPath = join(agentSkillsDir, skillName);
    const ok = createRelativeSymlink(canonicalSkillDir, linkPath);

    if (ok) {
      installed.push(linkPath);
    } else {
      // Fallback to copy
      mkdirSync(linkPath, { recursive: true });
      writeFileSync(join(linkPath, "SKILL.md"), content);
      installed.push(linkPath);
    }
  }

  return installed;
}

export function installCopy(
  skillName: string,
  content: string,
  agents: AgentDefinition[],
  opts: InstallOptions,
): string[] {
  const base = opts.projectRoot;
  const installed: string[] = [];

  for (const agent of agents) {
    const agentSkillsDir = join(base, agent.localSkillsDir);
    const skillDir = join(agentSkillsDir, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
    installed.push(skillDir);
  }

  return installed;
}
