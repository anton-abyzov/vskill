// ---------------------------------------------------------------------------
// 0698 T-003: Standalone authoring scanner
//
// Walks `<root>/skills/<skill>/SKILL.md` and emits SkillInfo entries as
// AUTHORING > Skills. Excludes any skill whose filesystem path sits under a
// plugin-source folder (i.e. a directory with `.claude-plugin/plugin.json`
// somewhere between it and the project root) — those are owned by T-005's
// authored-plugin scanner.
//
// Cross-agent: unlike T-004's installed-plugin scanner which is Claude Code
// only, standalone authoring works identically for every agent. No agentId
// parameter.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SkillInfo } from "./skill-scanner.js";

/**
 * Scan the standalone authoring location (`<root>/skills/`).
 * Returns SkillInfo entries with scope="own", scopeV2="authoring-project",
 * group="authoring", source="project".
 */
export function scanStandaloneSkills(root: string): SkillInfo[] {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  const results: SkillInfo[] = [];
  for (const name of entries) {
    const skillDir = join(skillsDir, name);

    let isDir = false;
    try {
      isDir = statSync(skillDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const skillMd = join(skillDir, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    // Exclude: a skill is NOT standalone-authored if any ancestor directory
    // (up to root) contains `.claude-plugin/plugin.json`. In our top-level
    // scan of `<root>/skills/` the only meaningful check is whether root
    // itself is a plugin source AND the scan is happening inside that plugin.
    // For the top-level `<root>/skills/` path, this check reduces to: is
    // `<root>/.claude-plugin/plugin.json` present?
    if (hasPluginManifestAt(root)) continue;

    results.push({
      plugin: "",
      skill: name,
      dir: skillDir,
      hasEvals: false,
      hasBenchmark: false,
      origin: "source",
      scope: "own",
      scopeV2: "authoring-project",
      group: "authoring",
      source: "project",
      precedenceRank: 3,
      installMethod: "authored",
      sourceAgent: null,
    });
  }

  return results;
}

function hasPluginManifestAt(dir: string): boolean {
  return existsSync(join(dir, ".claude-plugin", "plugin.json"));
}
