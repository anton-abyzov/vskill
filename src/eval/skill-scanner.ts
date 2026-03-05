// ---------------------------------------------------------------------------
// Filesystem scanner for plugin skills
// ---------------------------------------------------------------------------

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

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

  let plugins: string[];
  try {
    plugins = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return skills;
  }

  for (const plugin of plugins) {
    const skillsDir = join(root, plugin, "skills");
    if (!existsSync(skillsDir)) continue;

    let skillDirs: string[];
    try {
      skillDirs = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
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

  return skills;
}
