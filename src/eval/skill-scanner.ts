// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
//
// Supports two layouts:
//   1. Plugin layout:  {root}/{plugin}/skills/{skill}/SKILL.md
//   2. Root layout:    {root}/skills/{skill}/SKILL.md  (plugin = repo basename)
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

  // Layout 2: root-level skills/ directory → {root}/skills/{skill}/SKILL.md
  scanSkillsDir(root, basename(root) || "default", join(root, "skills"), skills);

  // Layout 1: plugin subdirs → {root}/{plugin}/skills/{skill}/SKILL.md
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "skills")
      .map((d) => d.name);
  } catch {
    return skills;
  }

  for (const plugin of entries) {
    scanSkillsDir(root, plugin, join(root, plugin, "skills"), skills);
  }

  return skills;
}

function scanSkillsDir(
  _root: string,
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
