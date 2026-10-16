// ---------------------------------------------------------------------------
// Core Skills Sync — copy sw:* skills to all detected agents during init
// ---------------------------------------------------------------------------

import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import os from "node:os";
import type { AgentDefinition } from "../agents/agents-registry.js";
import { installSymlink } from "../installer/canonical.js";
import { compareVersions, parseVersion } from "../utils/semver.js";

/** The version a plugin cache folder holds: its `.claude-plugin/plugin.json`
 *  version when readable, else the folder name. Folder names are not reliable
 *  (Claude Code reuses a folder named `2.1.0` for later plugin versions). */
export function pluginFolderVersion(folder: string): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(folder, ".claude-plugin", "plugin.json"), "utf-8"),
    ) as { version?: unknown };
    if (typeof manifest.version === "string" && parseVersion(manifest.version)) {
      return manifest.version.trim();
    }
  } catch {
    // No manifest or unreadable: fall back to the folder name.
  }
  return basename(folder);
}

/**
 * Pick the newest plugin version folder by semver (3.0.14 beats 3.0.6),
 * reading each folder's plugin.json version first. Ties fall back to the
 * folder name. Returns null for an empty list.
 */
export function pickLatestVersionFolder(base: string, folders: string[]): string | null {
  if (folders.length === 0) return null;
  const ranked = folders.map((name) => ({ name, version: pluginFolderVersion(join(base, name)) }));
  ranked.sort((a, b) => compareVersions(b.version, a.version) || compareVersions(b.name, a.name));
  return ranked[0].name;
}

/**
 * Find the directory containing core SpecWeave skills (sw:* plugin).
 *
 * Search order:
 * 1. Claude Code plugin cache: ~/.claude/plugins/cache/specweave/sw/{version}/skills/
 *    (newest version by semver, see pickLatestVersionFolder)
 * 2. Bundled with vskill package: {packageDir}/../skills/ (for npm distribution)
 */
export function findCoreSkillsDir(opts: { home?: string } = {}): string | null {
  // 1. Claude Code plugin cache
  const pluginCacheBase = join(
    opts.home ?? os.homedir(),
    ".claude",
    "plugins",
    "cache",
    "specweave",
    "sw",
  );
  if (existsSync(pluginCacheBase)) {
    try {
      const versions = readdirSync(pluginCacheBase).filter((v) => {
        if (v.startsWith(".")) return false;
        const p = join(pluginCacheBase, v, "skills");
        return existsSync(p) && statSync(p).isDirectory();
      });
      const latestVersion = pickLatestVersionFolder(pluginCacheBase, versions);
      if (latestVersion) {
        return join(pluginCacheBase, latestVersion, "skills");
      }
    } catch {
      // Permission error or similar — fall through
    }
  }

  // 2. Bundled skills (relative to compiled dist/)
  const distDir = new URL(".", import.meta.url).pathname;
  const bundledPath = join(distDir, "..", "..", "skills");
  if (existsSync(bundledPath) && statSync(bundledPath).isDirectory()) {
    return bundledPath;
  }

  return null;
}

/**
 * Read all files in a skill directory (SKILL.md + agents/*.md).
 */
function readSkillFiles(
  skillDir: string,
): { content: string; agentFiles: Record<string, string> } | null {
  const skillMdPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillMdPath)) return null;

  const content = readFileSync(skillMdPath, "utf-8");
  const agentFiles: Record<string, string> = {};

  const agentsDir = join(skillDir, "agents");
  if (existsSync(agentsDir) && statSync(agentsDir).isDirectory()) {
    for (const file of readdirSync(agentsDir)) {
      if (file.endsWith(".md")) {
        agentFiles[`agents/${file}`] = readFileSync(
          join(agentsDir, file),
          "utf-8",
        );
      }
    }
  }

  return { content, agentFiles };
}

/**
 * List all core skill names available at the given source directory.
 */
export function listCoreSkills(sourceDir: string): string[] {
  return readdirSync(sourceDir).filter((name) => {
    const p = join(sourceDir, name);
    return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md"));
  });
}

/**
 * Sync core SpecWeave skills to detected agents.
 *
 * Writes to .agents/skills/sw/{skill}/ (canonical source) and creates
 * symlinks from each agent's localSkillsDir (e.g. .opencode/skills/sw/{skill}/).
 *
 * Claude Code is included because it reads project-local .claude/skills/ too,
 * and the plugin cache is only available when Claude Code CLI is installed.
 *
 * Returns the number of skills synced.
 */
export function syncCoreSkills(
  agents: AgentDefinition[],
  projectRoot: string,
  coreSkillsDir: string,
): number {
  if (agents.length === 0) return 0;

  const skillNames = listCoreSkills(coreSkillsDir);
  let synced = 0;

  for (const skillName of skillNames) {
    const skill = readSkillFiles(join(coreSkillsDir, skillName));
    if (!skill) continue;

    const namespacedName = join("sw", skillName);
    try {
      installSymlink(
        namespacedName,
        skill.content,
        agents,
        { global: false, projectRoot },
        Object.keys(skill.agentFiles).length > 0
          ? skill.agentFiles
          : undefined,
      );
      synced++;
    } catch {
      // Non-fatal — skip this skill and continue
    }
  }

  return synced;
}
