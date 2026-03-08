// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
//
// Supports three layouts (all scanned from root=cwd):
//   1. Direct:   {root}/{plugin}/skills/{skill}/SKILL.md
//   2. Nested:   {root}/plugins/{plugin}/skills/{skill}/SKILL.md
//   3. Root:     {root}/skills/{skill}/SKILL.md  (plugin = repo basename)
// ---------------------------------------------------------------------------

import { readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export interface SkillInfo {
  plugin: string;
  skill: string;
  dir: string;
  hasEvals: boolean;
  hasBenchmark: boolean;
}

export async function scanSkills(root: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];

  if (!existsSync(root)) return skills;

  // Layout 3: root-level skills/ directory → {root}/skills/{skill}/SKILL.md
  scanSkillsDir(basename(root) || "default", join(root, "skills"), skills);

  // Layout 1: direct plugin subdirs → {root}/{plugin}/skills/{skill}/SKILL.md
  // Exclude "skills" (Layout 3) and "plugins" (Layout 2) from being treated as plugins
  scanPluginDirs(root, skills, ["skills", "plugins"]);

  // Layout 2: nested plugins/ dir → {root}/plugins/{plugin}/skills/{skill}/SKILL.md
  // Only exclude "plugins" to prevent recursion; "skills" is a valid plugin name here
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    scanPluginDirs(pluginsDir, skills, ["plugins"]);
  }

  return skills;
}

function scanPluginDirs(dir: string, skills: SkillInfo[], exclude: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !exclude.includes(d.name))
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const plugin of entries) {
    scanSkillsDir(plugin, join(dir, plugin, "skills"), skills);
  }
}

function scanSkillsDir(
  plugin: string,
  skillsDir: string,
  skills: SkillInfo[],
): void {
  if (!existsSync(skillsDir)) return;

  let skillDirs: string[];
  try {
    skillDirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }

  for (const skill of skillDirs) {
    const skillDir = join(skillsDir, skill);
    const skillMd = join(skillDir, "SKILL.md");

    if (!existsSync(skillMd)) continue;

    const hasEvals = existsSync(join(skillDir, "evals", "evals.json"));
    const hasBenchmark = existsSync(
      join(skillDir, "evals", "benchmark.json"),
    );

    skills.push({ plugin, skill, dir: skillDir, hasEvals, hasBenchmark });
  }
}
