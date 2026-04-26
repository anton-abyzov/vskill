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
 * 4b. Any agent's plugin marketplace dir (e.g. ~/.claude/plugins/marketplaces/ — marketplace
 *     sources have an extra /plugins/ segment compared to the cache tree).
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

  // 3 + 4 + 4b. Check every registered agent's global skills dir, plugin cache,
  // and marketplace source dir.
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

    if (agent.pluginMarketplaceDir) {
      const mktRoot = agent.pluginMarketplaceDir.replace("~", home);
      try {
        if (existsSync(mktRoot)) {
          for (const mkt of readdirSync(mktRoot, { withFileTypes: true })) {
            if (!mkt.isDirectory()) continue;
            const pluginsDir = join(mktRoot, mkt.name, "plugins");
            if (!existsSync(pluginsDir)) continue;
            for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
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

    if (agent.pluginMarketplaceDir) {
      const mktRoot = agent.pluginMarketplaceDir.replace("~", home);
      try {
        if (existsSync(mktRoot)) {
          for (const mkt of readdirSync(mktRoot, { withFileTypes: true })) {
            if (!mkt.isDirectory()) continue;
            const pluginsDir = join(mktRoot, mkt.name, "plugins");
            if (!existsSync(pluginsDir)) continue;
            for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
              if (plugin.isDirectory() && plugin.name.includes("skill-creator")) {
                return join(pluginsDir, plugin.name);
              }
            }
          }
        }
      } catch { /* ignore permission errors */ }
    }
  }

  return null;
}
