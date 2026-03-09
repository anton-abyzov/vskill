// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
//
// Supports four layouts (all scanned from root=cwd):
//   1. Direct:   {root}/{plugin}/skills/{skill}/SKILL.md
//   2. Nested:   {root}/plugins/{plugin}/skills/{skill}/SKILL.md
//   3. Root:     {root}/skills/{skill}/SKILL.md  (plugin = repo basename)
//   4. Self:     {root}/SKILL.md  (root IS the skill directory itself)
// ---------------------------------------------------------------------------

import { readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";

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

  // Layout 4: root IS the skill directory itself → {root}/SKILL.md
  // Walk up from the skill dir to find the plugin name:
  //   .../plugins/{plugin}/skills/{skill}/  →  plugin = grandparent of skill
  //   .../skills/{skill}/                   →  plugin = parent above "skills"
  // Fallback to immediate parent if structure is unknown.
  if (existsSync(join(root, "SKILL.md"))) {
    const skillName = basename(root);
    const parent = basename(dirname(root)); // e.g. "skills"
    let pluginName: string;
    if (parent === "skills") {
      // Standard layout: .../plugins/{plugin}/skills/{skill}/ or .../{plugin}/skills/{skill}/
      pluginName = basename(dirname(dirname(root))) || "default";
    } else {
      pluginName = parent || "default";
    }
    const hasEvals = existsSync(join(root, "evals", "evals.json"));
    const hasBenchmark = existsSync(join(root, "evals", "benchmark.json"));
    skills.push({
      plugin: pluginName,
      skill: skillName,
      dir: root,
      hasEvals,
      hasBenchmark,
    });
    return skills;
  }

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
