// ---------------------------------------------------------------------------
// vskill eval generate-all -- batch scaffold evals.json for all skills
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSkills } from "../../eval/skill-scanner.js";
import { createLlmClient } from "../../eval/llm.js";
import { buildEvalInitPrompt, parseGeneratedEvals } from "../../eval/prompt-builder.js";
import { green, red, yellow, bold, dim } from "../../utils/output.js";

export async function runEvalGenerateAll(
  root: string,
  force: boolean,
): Promise<void> {
  const skills = await scanSkills(root);

  if (skills.length === 0) {
    console.log(dim("No skills found in " + root));
    return;
  }

  const client = createLlmClient();
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const failedPaths: string[] = [];

  for (const skill of skills) {
    const evalsPath = join(skill.dir, "evals", "evals.json");

    // Skip if evals already exist and not forcing
    if (skill.hasEvals && !force) {
      skipped++;
      continue;
    }

    const skillMdPath = join(skill.dir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      failed++;
      failedPaths.push(`${skill.plugin}/${skill.skill} (no SKILL.md)`);
      continue;
    }

    try {
      const skillContent = readFileSync(skillMdPath, "utf-8");
      const prompt = buildEvalInitPrompt(skillContent);

      const raw = await client.generate(
        "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
        prompt,
      );

      const evalsFile = parseGeneratedEvals(raw);

      mkdirSync(join(skill.dir, "evals"), { recursive: true });
      writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

      generated++;
      console.log(green(`  Generated: ${skill.plugin}/${skill.skill}`));
    } catch (err) {
      failed++;
      failedPaths.push(`${skill.plugin}/${skill.skill}`);
      console.error(
        red(`  Failed: ${skill.plugin}/${skill.skill} - `) +
          dim((err as Error).message),
      );
    }
  }

  // Print summary
  console.log(bold(`\nBatch Generation Summary`));
  console.log(`  Scanned: ${skills.length}`);
  console.log(`  ${green(`Generated: ${generated}`)}`);
  console.log(`  ${yellow(`Skipped: ${skipped}`)}`);
  console.log(`  ${failed > 0 ? red(`Failed: ${failed}`) : `Failed: ${failed}`}`);

  if (failedPaths.length > 0) {
    console.log(red("\nFailed skills:"));
    for (const path of failedPaths) {
      console.log(red(`  - ${path}`));
    }
  }
}
