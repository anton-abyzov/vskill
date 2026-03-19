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
 * 3. Any registered agent's global skills directory
 * 4. Any agent's plugin cache (e.g. Claude Code plugin cache)
 */
export function isSkillCreatorInstalled(projectRoot?: string): boolean {
  const home = homedir();

  // 1. Global canonical path (source of truth for vskill install --global)
  if (existsSync(join(home, ".agents", "skills", "skill-creator"))) return true;

  // 2. Project-local canonical path (source of truth for vskill install)
  if (projectRoot && existsSync(join(projectRoot, ".agents", "skills", "skill-creator"))) {
    return true;
  }

  // 3 + 4. Check every registered agent's global skills dir and plugin cache
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
