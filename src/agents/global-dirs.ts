// ---------------------------------------------------------------------------
// 0894: one resolver for an agent's global skills dir(s).
//
// Kept apart from agents-registry.ts on purpose: many command tests mock the
// registry module wholesale, and callers (remove, add, Studio scans) need
// these helpers to keep working under those mocks. Pure: depends only on the
// agent definition, $HOME and the filesystem.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import type { AgentDefinition } from "./agents-registry.js";

/** Antigravity's legacy IDE global skills folder. */
export const ANTIGRAVITY_LEGACY_GLOBAL_DIR = "~/.gemini/antigravity/skills";

type AgentDirs = Pick<AgentDefinition, "id" | "globalSkillsDir">;

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return home + p.slice(1);
  }
  return p;
}

/**
 * The global skills dir vskill installs an agent's skills into. Antigravity:
 * `VSKILL_ANTIGRAVITY_SKILLS_DIR`, then the legacy IDE dir when it already
 * exists, else the registry default. Every other agent: its `globalSkillsDir`.
 */
export function resolveAgentGlobalSkillsDir(
  agent: AgentDirs,
  expand: (p: string) => string = expandHome,
): string {
  if (agent.id === "antigravity") {
    const override = process.env.VSKILL_ANTIGRAVITY_SKILLS_DIR;
    if (override && override.trim().length > 0) return override.trim();
    const legacy = expand(ANTIGRAVITY_LEGACY_GLOBAL_DIR);
    try {
      if (existsSync(legacy)) return legacy;
    } catch {
      // fall through to the default
    }
  }
  return expand(agent.globalSkillsDir);
}

/**
 * Every global dir vskill may have put this agent's skills in: the resolved
 * dir first, then the registry default and, for Antigravity, the legacy IDE
 * dir (installs went there while it existed). Used by remove, uninstall,
 * Studio scans and detection so none of them miss an install. `expand`
 * resolves a `~/` path (callers pass their own tilde resolver).
 */
export function agentGlobalInstallDirs(
  agent: AgentDirs,
  expand: (p: string) => string = expandHome,
): string[] {
  const dirs = [resolveAgentGlobalSkillsDir(agent, expand), expand(agent.globalSkillsDir)];
  if (agent.id === "antigravity") dirs.push(expand(ANTIGRAVITY_LEGACY_GLOBAL_DIR));
  return [...new Set(dirs)];
}
