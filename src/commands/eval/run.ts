// ---------------------------------------------------------------------------
// vskill eval run -- execute eval cases and grade assertions
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAndValidateEvals, EvalValidationError } from "../../eval/schema.js";
import { createLlmClient, estimateDurationSec } from "../../eval/llm.js";
import type { ProviderName } from "../../eval/llm.js";
import { judgeAssertion } from "../../eval/judge.js";
import { writeBenchmark } from "../../eval/benchmark.js";
import type { BenchmarkCase, BenchmarkResult } from "../../eval/benchmark.js";
import { green, red, yellow, bold, dim, table } from "../../utils/output.js";
import { buildEvalSystemPrompt } from "../../eval/prompt-builder.js";
import { classifyError } from "../../eval-server/error-classifier.js";
import { ProgressLog } from "../../eval/progress-log.js";

export async function runEvalRun(skillDir: string): Promise<void> {
  // Load and validate evals.json
  let evalsFile;
  try {
    evalsFile = loadAndValidateEvals(skillDir);
  } catch (err) {
    if (err instanceof EvalValidationError) {
      const firstMsg = err.errors[0]?.message || "";
      if (firstMsg.includes("No evals.json")) {
        console.error(red(`No evals.json found at ${skillDir}/evals/evals.json`));
      } else {
        console.error(red(`Invalid evals.json: ${err.message}`));
      }
    } else {
      console.error(red(`Error loading evals: ${(err as Error).message}`));
    }
    process.exit(1);
    return;
  }

  // Load SKILL.md content for the system prompt
  const skillMdPath = join(skillDir, "SKILL.md");
  let skillContent = "";
  if (existsSync(skillMdPath)) {
    skillContent = readFileSync(skillMdPath, "utf-8");
  } else {
    console.error(yellow(`Warning: No SKILL.md found at ${skillMdPath} — running evals without skill content`));
  }

  const systemPrompt = buildEvalSystemPrompt(skillContent);

  const client = createLlmClient();
  const model = client.model;
  const provider = (process.env.VSKILL_EVAL_PROVIDER || "claude-cli") as ProviderName;
  const total = evalsFile.evals.length;
  const totalAssertions = evalsFile.evals.reduce((s, e) => s + e.assertions.length, 0);

  console.log(dim(`Provider: ${model} | ${total} eval case${total !== 1 ? "s" : ""} | ${totalAssertions} assertions`));
  console.log(dim(`Skill: ${skillContent ? skillMdPath : "(none)"}`));

  // Duration estimate
  const estimate = estimateDurationSec(provider, total, totalAssertions);
  console.log(dim(`Estimated duration: ${estimate.label}`));
  console.log(dim(`Progress file: ${join(skillDir, "evals", ".eval-progress.json")}\n`));

  // Start progress log
  const progress = new ProgressLog(skillDir, provider, model, total, estimate.maxSec);

  const benchmarkCases: BenchmarkCase[] = [];
  const tableRows: string[][] = [];
  const runStart = Date.now();

  for (let i = 0; i < evalsFile.evals.length; i++) {
    const evalCase = evalsFile.evals[i];
    const caseStart = Date.now();

    progress.update({
      currentCase: evalCase.name,
      phase: "generating",
      completedCases: i,
    });

    try {
      // Step 1: Send prompt to LLM
      process.stdout.write(dim(`[${i + 1}/${total}] ${evalCase.name} — generating...`));
      const genResult = await client.generate(systemPrompt, evalCase.prompt);
      const genSec = ((Date.now() - caseStart) / 1000).toFixed(1);
      process.stdout.write(dim(` ${genSec}s`));

      progress.update({ phase: "judging" });

      process.stdout.write(dim(` judging ${evalCase.assertions.length} assertions...`));

      // Step 2: Judge each assertion
      const assertionResults = [];
      let passCount = 0;

      for (const assertion of evalCase.assertions) {
        const result = await judgeAssertion(genResult.text, assertion, client);
        assertionResults.push(result);
        if (result.pass) passCount++;

        const truncatedText =
          assertion.text.length > 60
            ? assertion.text.slice(0, 57) + "..."
            : assertion.text;

        tableRows.push([
          evalCase.name,
          assertion.id,
          truncatedText,
          result.pass ? green("PASS") : red("FAIL"),
        ]);
      }

      const passRate = evalCase.assertions.length > 0
        ? passCount / evalCase.assertions.length
        : 0;
      const allPassed = passCount === evalCase.assertions.length;
      const totalSec = ((Date.now() - caseStart) / 1000).toFixed(1);
      console.log(
        allPassed
          ? green(` done`) + dim(` (${totalSec}s)`)
          : red(` ${passCount}/${evalCase.assertions.length} passed`) + dim(` (${totalSec}s)`),
      );

      benchmarkCases.push({
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        status: allPassed ? "pass" : "fail",
        error_message: null,
        pass_rate: passRate,
        assertions: assertionResults,
      });
    } catch (err) {
      const classified = classifyError(err, provider);
      console.log(yellow(" error"));
      console.log(yellow(`  ${classified.title}: ${classified.description}`));
      console.log(dim(`  ${classified.hint}`));

      progress.update({ lastError: classified.title });

      benchmarkCases.push({
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        status: "error",
        error_message: (err as Error).message,
        pass_rate: 0,
        assertions: [],
      });

      tableRows.push([
        evalCase.name,
        "-",
        dim(`${classified.title}`),
        yellow("ERROR"),
      ]);

      // For auth errors, all subsequent cases will fail too — abort early
      if (classified.category === "auth" || classified.category === "provider_unavailable") {
        console.log(red(`\nAborting remaining cases — ${classified.category} error is not recoverable.`));
        console.log(dim(`  ${classified.hint}\n`));
        break;
      }
    }
  }

  // Complete progress tracking
  progress.complete();

  const totalElapsed = ((Date.now() - runStart) / 1000).toFixed(1);

  // Print results table
  const headers = ["EVAL", "ASSERTION", "TEXT", "STATUS"];
  console.log(bold(`\nEval Results: ${evalsFile.skill_name}\n`));
  console.log(table(headers, tableRows));

  // Compute summary
  const passed = benchmarkCases.filter((c) => c.status === "pass").length;
  const failed = benchmarkCases.filter((c) => c.status === "fail").length;
  const errors = benchmarkCases.filter((c) => c.status === "error").length;
  console.log(
    `\n${green(`${passed} passed`)} ${failed > 0 ? red(`${failed} failed`) : ""} ${errors > 0 ? yellow(`${errors} errors`) : ""} ${dim(`(${totalElapsed}s)`)}`.trim(),
  );

  // Write benchmark.json
  const benchmark: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    model,
    skill_name: evalsFile.skill_name,
    cases: benchmarkCases,
  };

  await writeBenchmark(skillDir, benchmark);
  console.log(dim(`\nBenchmark written to ${skillDir}/evals/benchmark.json`));
}
