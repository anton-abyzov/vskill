// ---------------------------------------------------------------------------
// 0747 T-001: scanSkillInstallLocations
//
// Find every install location of a skill across all installable agents (project
// + personal scopes) plus the Claude Code plugin cache. Returns a flat array
// describing each location for the Studio's smart-click + chip-strip features.
//
// Reuses:
//   - getInstallableAgents()  → registry of agent dirs
//   - scanInstalledPluginSkills() → walks ~/.claude/plugins/cache/.../skills/
//
// SECURITY: the canonical name's last segment is sanitized (no path traversal,
// no separators) before being interpolated into any filesystem path.
// ---------------------------------------------------------------------------

import { existsSync, lstatSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  getInstallableAgents,
  type AgentDefinition,
} from "../../agents/agents-registry.js";
import { scanInstalledPluginSkills } from "../../eval/plugin-scanner.js";

export type InstallLocationScope = "project" | "personal" | "plugin";

export interface InstallLocation {
  scope: InstallLocationScope;
  agent: string;
  agentLabel: string;
  dir: string;
  pluginSlug?: string;
  pluginMarketplace?: string;
  symlinked: boolean;
  readonly: boolean;
}

const VALID_SLUG = /^[a-zA-Z0-9._-]+$/;

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home + p.slice(1);
  }
  return p;
}

function deriveSkillSlug(canonicalName: string): string | null {
  const last = canonicalName.split("/").pop() ?? "";
  if (!last || !VALID_SLUG.test(last)) return null;
  if (last === "." || last === "..") return null;
  return last;
}

function isSymlinkPointingInside(dir: string): boolean {
  try {
    const st = lstatSync(dir);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

function probeSkill(dir: string): boolean {
  // Skill folder is "real" when it contains SKILL.md.
  try {
    const md = join(dir, "SKILL.md");
    return existsSync(md) && statSync(md).isFile();
  } catch {
    return false;
  }
}

function safeJoinUnder(rootDir: string, slug: string): string | null {
  // Defense in depth: ensure the resulting path stays under rootDir.
  const candidate = join(rootDir, slug);
  const resolved = resolve(candidate);
  const resolvedRoot = resolve(rootDir);
  if (!resolved.startsWith(resolvedRoot + sep) && resolved !== resolvedRoot) {
    return null;
  }
  return candidate;
}

function projectAgentLocation(
  agent: AgentDefinition,
  projectRoot: string,
  slug: string,
): InstallLocation | null {
  const localDir = isAbsolute(agent.localSkillsDir)
    ? agent.localSkillsDir
    : join(projectRoot, agent.localSkillsDir);
  const skillDir = safeJoinUnder(localDir, slug);
  if (!skillDir || !probeSkill(skillDir)) return null;
  return {
    scope: "project",
    agent: agent.id,
    agentLabel: agent.displayName,
    dir: skillDir,
    symlinked: isSymlinkPointingInside(skillDir),
    readonly: false,
  };
}

function personalAgentLocation(
  agent: AgentDefinition,
  slug: string,
): InstallLocation | null {
  const globalDir = expandHome(agent.globalSkillsDir);
  const skillDir = safeJoinUnder(globalDir, slug);
  if (!skillDir || !probeSkill(skillDir)) return null;
  return {
    scope: "personal",
    agent: agent.id,
    agentLabel: agent.displayName,
    dir: skillDir,
    symlinked: isSymlinkPointingInside(skillDir),
    readonly: false,
  };
}

function pluginLocations(slug: string): InstallLocation[] {
  // scanInstalledPluginSkills walks ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>
  // Filter for matching skill slug.
  const skills = scanInstalledPluginSkills({ agentId: "claude-code" });
  return skills
    .filter((s) => s.skill === slug)
    .map((s) => ({
      scope: "plugin" as const,
      agent: "claude-code",
      agentLabel: "Claude Code",
      dir: s.dir,
      pluginSlug: s.pluginName ?? undefined,
      pluginMarketplace: s.pluginMarketplace ?? undefined,
      symlinked: false,
      readonly: true,
    }));
}

/**
 * Find every install location of a skill identified by its canonical platform
 * name (e.g. "anton-abyzov/greet-anton/greet-anton"). Returns one entry per
 * (scope, agent, dir) triple where SKILL.md is present. Returns [] for
 * malformed or path-traversal-laden names.
 */
export function scanSkillInstallLocations(
  canonicalName: string,
  projectRoot: string = process.cwd(),
): InstallLocation[] {
  const slug = deriveSkillSlug(canonicalName);
  if (!slug) return [];

  const out: InstallLocation[] = [];
  const agents = getInstallableAgents();

  for (const agent of agents) {
    const proj = projectAgentLocation(agent, projectRoot, slug);
    if (proj) out.push(proj);

    const personal = personalAgentLocation(agent, slug);
    if (personal) out.push(personal);
  }

  out.push(...pluginLocations(slug));

  return out;
}

// Suppress unused-import warning for `dirname` if tree-shaking reports it.
void dirname;
