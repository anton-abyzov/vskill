// ---------------------------------------------------------------------------
// vskill eval init -- scaffold evals.json for a skill using LLM
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "../../eval/llm.js";
import { buildEvalInitPrompt, parseGeneratedEvals } from "../../eval/prompt-builder.js";
import { green, red, dim, yellow } from "../../utils/output.js";

export async function runEvalInit(
  skillDir: string,
  force: boolean,
): Promise<void> {
  const skillMdPath = join(skillDir, "SKILL.md");
  const evalsDir = join(skillDir, "evals");
  const evalsPath = join(evalsDir, "evals.json");

  // Check SKILL.md exists
  if (!existsSync(skillMdPath)) {
    console.error(red(`SKILL.md not found at ${skillMdPath}`));
    return;
  }

  // Check existing evals.json
  if (existsSync(evalsPath) && !force) {
    console.log(
      yellow("evals.json already exists, use --force to overwrite"),
    );
    return;
  }

  const skillContent = readFileSync(skillMdPath, "utf-8");
  const prompt = buildEvalInitPrompt(skillContent);

  try {
    const client = createLlmClient();
    const raw = await client.generate(
      "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
      prompt,
    );

    const evalsFile = parseGeneratedEvals(raw);

    mkdirSync(evalsDir, { recursive: true });
    writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

    console.log(green(`Created ${evalsPath}`));
    console.log(
      dim(`  ${evalsFile.evals.length} eval cases, ${evalsFile.evals.reduce((sum, e) => sum + e.assertions.length, 0)} assertions`),
    );
  } catch (err) {
    console.error(
      red("Failed to generate evals: ") + dim((err as Error).message),
    );
  }
}
