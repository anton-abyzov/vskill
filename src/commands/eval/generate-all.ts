// ---------------------------------------------------------------------------
// vskill eval generate-all -- batch scaffold evals.json for all skills
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scanSkills } from "../../eval/skill-scanner.js";
import { createLlmClient } from "../../eval/llm.js";
import type { ProviderName } from "../../eval/llm.js";
import { buildEvalInitPrompt, parseGeneratedEvals } from "../../eval/prompt-builder.js";
import { Semaphore } from "../../eval/concurrency.js";
import { green, red, yellow, bold, dim } from "../../utils/output.js";

const CLI_PROVIDERS = new Set<ProviderName>(["claude-cli", "codex-cli", "gemini-cli"]);

function resolveProvider(): { provider: ProviderName; autoSelected: boolean } {
  const explicit = process.env.VSKILL_EVAL_PROVIDER as ProviderName | undefined;
  if (explicit) return { provider: explicit, autoSelected: false };

  // Auto-select anthropic for batch ops when API key is available
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", autoSelected: true };
  }

  return { provider: "claude-cli", autoSelected: false };
}

function resolveConcurrency(
  explicitConcurrency: number | undefined,
  provider: ProviderName,
): number {
  if (explicitConcurrency !== undefined) return Math.max(1, explicitConcurrency);
  return CLI_PROVIDERS.has(provider) ? 1 : 3;
}

export async function runEvalGenerateAll(
  root: string,
  force: boolean,
  concurrency?: number,
): Promise<void> {
  const skills = await scanSkills(root);

  if (skills.length === 0) {
    console.log(dim("No skills found in " + root));
    return;
  }

  const { provider, autoSelected } = resolveProvider();
  const effectiveConcurrency = resolveConcurrency(concurrency, provider);

  if (autoSelected) {
    console.log(dim("Auto-selected anthropic provider for batch operation"));
  }
  console.log(dim(`Provider: ${provider} | Concurrency: ${effectiveConcurrency}`));

  const client = createLlmClient({ provider });
  const sem = new Semaphore(effectiveConcurrency);
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  const failedPaths: string[] = [];

  // Filter skills that need generation
  const toGenerate = skills.filter((skill) => {
    if (skill.hasEvals && !force) {
      skipped++;
      return false;
    }
    const skillMdPath = join(skill.dir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      failed++;
      failedPaths.push(`${skill.plugin}/${skill.skill} (no SKILL.md)`);
      return false;
    }
    return true;
  });

  // Process all skills concurrently with semaphore gating
  const results = await Promise.allSettled(
    toGenerate.map(async (skill) => {
      await sem.acquire();
      try {
        const skillMdPath = join(skill.dir, "SKILL.md");
        const evalsPath = join(skill.dir, "evals", "evals.json");
        const skillContent = readFileSync(skillMdPath, "utf-8");
        const prompt = buildEvalInitPrompt(skillContent);

        const genResult = await client.generate(
          "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
          prompt,
        );

        const evalsFile = parseGeneratedEvals(genResult.text);

        mkdirSync(join(skill.dir, "evals"), { recursive: true });
        writeFileSync(evalsPath, JSON.stringify(evalsFile, null, 2), "utf-8");

        console.log(green(`  Generated: ${skill.plugin}/${skill.skill}`));
        return { skill, success: true as const };
      } catch (err) {
        console.error(
          red(`  Failed: ${skill.plugin}/${skill.skill} - `) +
            dim((err as Error).message),
        );
        return { skill, success: false as const, error: err as Error };
      } finally {
        sem.release();
      }
    }),
  );

  // Tally results
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value.success) {
        generated++;
      } else {
        failed++;
        failedPaths.push(`${r.value.skill.plugin}/${r.value.skill.skill}`);
      }
    } else {
      failed++;
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
