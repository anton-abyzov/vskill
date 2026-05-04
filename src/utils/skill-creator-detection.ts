// ---------------------------------------------------------------------------
// Shared skill-creator detection — used by eval serve + eval server API
// ---------------------------------------------------------------------------

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AGENTS_REGISTRY } from "../agents/agents-registry.js";

/**
 * Check if the skill-creator skill is installed in any known location.
 *
 * Detection order:
 * 1. Global canonical: ~/.agents/skills/skill-creator
 * 2. Project-local canonical: {projectRoot}/.agents/skills/skill-creator
 * 2b. Project-local agent-native: {projectRoot}/{agent.localSkillsDir}/skill-creator
 *     for every agent in AGENTS_REGISTRY (covers .claude/skills, .cursor/skills, etc.)
 * 3. Any registered agent's global skills directory
 * 4. Any agent's plugin cache (e.g. Claude Code plugin cache at ~/.claude/plugins/cache/)
 *
 * 0786 (AC-US2-01/02/04): the marketplace catalog at
 * `~/.claude/plugins/marketplaces/<mkt>/plugins/<name>` is NOT installation —
 * it is the *available* plugin index. Cache presence is the only evidence of
 * installation. Pre-0786 detection treated the catalog as installed and the
 * Engine Selector / `/api/skill-creator-status` mislabelled un-installed
 * engines as installed.
 */
export function isSkillCreatorInstalled(projectRoot?: string): boolean {
  const home = homedir();

  // 1. Global canonical path (source of truth for vskill install --global)
  if (existsSync(join(home, ".agents", "skills", "skill-creator"))) return true;

  // 2. Project-local canonical path (source of truth for vskill install)
  if (projectRoot && existsSync(join(projectRoot, ".agents", "skills", "skill-creator"))) {
    return true;
  }

  // 2b. Project-local agent-native install dirs (.claude/skills, .cursor/skills, …)
  if (projectRoot) {
    for (const agent of AGENTS_REGISTRY) {
      if (existsSync(join(projectRoot, agent.localSkillsDir, "skill-creator"))) return true;
    }
  }

  // 3 + 4. Check every registered agent's global skills dir and plugin cache.
  // 0786: marketplace catalog branch removed — see JSDoc above.
  for (const agent of AGENTS_REGISTRY) {
    const resolved = agent.globalSkillsDir.replace("~", home);
    if (existsSync(join(resolved, "skill-creator"))) return true;

    if (agent.pluginCacheDir) {
      const cacheDir = agent.pluginCacheDir.replace("~", home);
      try {
        if (existsSync(cacheDir)) {
          for (const mkt of readdirSync(cacheDir, { withFileTypes: true })) {
            if (!mkt.isDirectory()) continue;
            for (const plugin of readdirSync(join(cacheDir, mkt.name), { withFileTypes: true })) {
              if (plugin.isDirectory() && plugin.name.includes("skill-creator")) return true;
            }
          }
        }
      } catch { /* ignore permission errors */ }
    }
  }

  return false;
}

/**
 * Find the first path on disk where skill-creator is installed.
 *
 * Same search order as isSkillCreatorInstalled() but returns the matched path
 * (or null if not installed). Used by Studio's /api/studio/detect-engines route
 * to surface the install location to the UI.
 *
 * 0786: marketplace catalog branch removed (catalog presence is availability,
 * not installation).
 */
export function findSkillCreatorPath(projectRoot?: string): string | null {
  const home = homedir();

  const globalCanonical = join(home, ".agents", "skills", "skill-creator");
  if (existsSync(globalCanonical)) return globalCanonical;

  if (projectRoot) {
    const projectCanonical = join(projectRoot, ".agents", "skills", "skill-creator");
    if (existsSync(projectCanonical)) return projectCanonical;

    for (const agent of AGENTS_REGISTRY) {
      const candidate = join(projectRoot, agent.localSkillsDir, "skill-creator");
      if (existsSync(candidate)) return candidate;
    }
  }

  for (const agent of AGENTS_REGISTRY) {
    const resolved = agent.globalSkillsDir.replace("~", home);
    const candidate = join(resolved, "skill-creator");
    if (existsSync(candidate)) return candidate;

    if (agent.pluginCacheDir) {
      const cacheDir = agent.pluginCacheDir.replace("~", home);
      try {
        if (existsSync(cacheDir)) {
          for (const mkt of readdirSync(cacheDir, { withFileTypes: true })) {
            if (!mkt.isDirectory()) continue;
            for (const plugin of readdirSync(join(cacheDir, mkt.name), { withFileTypes: true })) {
              if (plugin.isDirectory() && plugin.name.includes("skill-creator")) {
                return join(cacheDir, mkt.name, plugin.name);
              }
            }
          }
        }
      } catch { /* ignore permission errors */ }
    }
  }

  return null;
}
