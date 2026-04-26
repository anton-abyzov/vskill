// ---------------------------------------------------------------------------
// Shared skill-builder detection — used by Studio detect-engines route.
// Mirrors skill-creator-detection.ts but returns { installed, path, version }
// so the route can report which path matched and the SKILL.md version.
// Ref: .specweave/increments/0734-studio-create-skill-engine-selector
// ACs: AC-US1-03, AC-US1-04
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { AGENTS_REGISTRY } from "../agents/agents-registry.js";

export interface SkillBuilderDetection {
  installed: boolean;
  path: string | null;
  version: string | null;
}

/**
 * Check if the skill-builder skill is installed in any known location.
 *
 * Detection order (first match wins):
 * 1. In-source workspace path: {projectRoot}/plugins/skills/skills/skill-builder/SKILL.md
 *    (where vskill ships skill-builder when developing in this monorepo)
 * 2. Global canonical: ~/.agents/skills/skill-builder
 * 3. Project-local canonical: {projectRoot}/.agents/skills/skill-builder
 * 4. Project-local agent-native: {projectRoot}/{agent.localSkillsDir}/skill-builder
 *    for every agent in AGENTS_REGISTRY (covers .claude/skills, .cursor/skills, etc.)
 * 5. Any registered agent's global skills directory
 * 6. Any agent's plugin cache or marketplace dir
 */
export function isSkillBuilderInstalled(projectRoot?: string): SkillBuilderDetection {
  const home = homedir();
  const candidates: string[] = [];

  if (projectRoot) {
    candidates.push(join(projectRoot, "plugins/skills/skills/skill-builder/SKILL.md"));
  }
  candidates.push(join(home, ".agents/skills/skill-builder"));
  if (projectRoot) {
    candidates.push(join(projectRoot, ".agents/skills/skill-builder"));
    for (const agent of AGENTS_REGISTRY) {
      candidates.push(join(projectRoot, agent.localSkillsDir, "skill-builder"));
    }
  }
  for (const agent of AGENTS_REGISTRY) {
    const resolved = agent.globalSkillsDir.replace("~", home);
    candidates.push(join(resolved, "skill-builder"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return {
        installed: true,
        path: candidate,
        version: parseVersionAt(candidate),
      };
    }
  }

  // Plugin cache + marketplace search — same shape as skill-creator-detection.
  for (const agent of AGENTS_REGISTRY) {
    if (agent.pluginCacheDir) {
      const cacheDir = agent.pluginCacheDir.replace("~", home);
      const match = findInPluginTree(cacheDir, /* hasPluginsSubdir */ false);
      if (match) return { installed: true, path: match, version: parseVersionAt(match) };
    }
    if (agent.pluginMarketplaceDir) {
      const mktRoot = agent.pluginMarketplaceDir.replace("~", home);
      const match = findInPluginTree(mktRoot, /* hasPluginsSubdir */ true);
      if (match) return { installed: true, path: match, version: parseVersionAt(match) };
    }
  }

  return { installed: false, path: null, version: null };
}

function findInPluginTree(rootDir: string, hasPluginsSubdir: boolean): string | null {
  try {
    if (!existsSync(rootDir)) return null;
    for (const mkt of readdirSync(rootDir, { withFileTypes: true })) {
      if (!mkt.isDirectory()) continue;
      const pluginsDir = hasPluginsSubdir ? join(rootDir, mkt.name, "plugins") : join(rootDir, mkt.name);
      if (!existsSync(pluginsDir)) continue;
      for (const plugin of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (plugin.isDirectory() && plugin.name.includes("skill-builder")) {
          return join(pluginsDir, plugin.name);
        }
      }
    }
  } catch {
    // ignore permission errors
  }
  return null;
}

function parseVersionAt(matchedPath: string): string | null {
  let skillMdPath: string;
  try {
    const stat = statSync(matchedPath);
    skillMdPath = stat.isDirectory() ? join(matchedPath, "SKILL.md") : matchedPath;
  } catch {
    return null;
  }
  if (!existsSync(skillMdPath)) return null;

  let content: string;
  try {
    content = readFileSync(skillMdPath, "utf8");
  } catch {
    return null;
  }

  // Frontmatter MUST be delimited by leading `---\n` and a closing `---` line.
  if (!content.startsWith("---\n")) return null;
  const closingIdx = content.indexOf("\n---", 4);
  if (closingIdx === -1) return null;
  const frontmatter = content.slice(4, closingIdx);

  const match = frontmatter.match(/^version:\s*["']?([^"'\n]+?)["']?\s*$/m);
  return match ? match[1] : null;
}
