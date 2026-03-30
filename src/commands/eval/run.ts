// ---------------------------------------------------------------------------
// vskill eval run -- execute eval cases and grade assertions
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadAndValidateEvals, EvalValidationError } from "../../eval/schema.js";
import { createLlmClient, estimateDurationSec } from "../../eval/llm.js";
import type { ProviderName, LlmClient } from "../../eval/llm.js";
import { judgeAssertion } from "../../eval/judge.js";
import { writeBenchmark } from "../../eval/benchmark.js";
import type { BenchmarkCase, BenchmarkResult } from "../../eval/benchmark.js";
import { green, red, yellow, bold, dim, table } from "../../utils/output.js";
import { buildEvalSystemPrompt } from "../../eval/prompt-builder.js";
import { classifyError } from "../../eval-server/error-classifier.js";
import { ProgressLog } from "../../eval/progress-log.js";
import { JudgeCache } from "../../eval/judge-cache.js";
import { checkWeakJudgeWarning } from "../../eval-server/benchmark-runner.js";
import { batchJudgeAssertions } from "../../eval/batch-judge.js";
import type { BatchJudgeRequest, BatchCostInfo } from "../../eval/batch-judge.js";

export interface EvalRunOptions {
  concurrency?: number;
  judgeModel?: string;   // "provider/model" format
  noCache?: boolean;
  batch?: boolean;
}

function parseJudgeModelSpec(spec: string): { provider: ProviderName; model: string } {
  const slashIndex = spec.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(`Invalid --judge-model format "${spec}". Expected "provider/model" (e.g., "anthropic/claude-haiku-3").`);
  }
  return {
    provider: spec.slice(0, slashIndex) as ProviderName,
    model: spec.slice(slashIndex + 1),
  };
}

export async function runEvalRun(skillDir: string, options?: EvalRunOptions): Promise<void> {
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

  // T-006: Create separate judge client if --judge-model is specified
  let judgeClient: LlmClient | undefined;
  if (options?.judgeModel) {
    const { provider: judgeProvider, model: judgeModelName } = parseJudgeModelSpec(options.judgeModel);
    judgeClient = createLlmClient({ provider: judgeProvider, model: judgeModelName });

    // Emit weak-model warning
    const warning = checkWeakJudgeWarning(model, judgeClient.model);
    if (warning) {
      console.warn(yellow(warning));
    }
  }
  const effectiveJudgeClient = judgeClient ?? client;

  // T-008: Judge cache (bypassed with --no-cache)
  const judgeCache = options?.noCache ? null : new JudgeCache(skillDir);

  console.log(dim(`Provider: ${model} | ${total} eval case${total !== 1 ? "s" : ""} | ${totalAssertions} assertions`));
  if (judgeClient) {
    console.log(dim(`Judge model: ${judgeClient.model}`));
  }
  if (judgeCache && !options?.noCache) {
    console.log(dim(`Judge cache: enabled (${judgeCache.size} cached entries)`));
  }
  console.log(dim(`Skill: ${skillContent ? skillMdPath : "(none)"}`));

  // T-025: Batch mode validation
  const useBatch = resolveBatchMode(options?.batch, provider);
  if (useBatch) {
    console.log(dim(`Batch mode: enabled (Anthropic Message Batches API — 50% cost savings)`));
  }

  // Duration estimate
  const estimate = estimateDurationSec(provider, total, totalAssertions);
  console.log(dim(`Estimated duration: ${estimate.label}`));
  console.log(dim(`Progress file: ${join(skillDir, "evals", ".eval-progress.json")}\n`));

  // Start progress log
  const progress = new ProgressLog(skillDir, provider, model, total, estimate.maxSec);

  const benchmarkCases: BenchmarkCase[] = [];
  const tableRows: string[][] = [];
  const runStart = Date.now();

  // T-026: Two-round execution for batch mode
  if (useBatch) {
    await runBatchMode(
      evalsFile, systemPrompt, client, effectiveJudgeClient, provider,
      progress, benchmarkCases, tableRows, total,
    );
  } else {
    await runSequentialMode(
      evalsFile, systemPrompt, client, effectiveJudgeClient, provider,
      judgeCache, progress, benchmarkCases, tableRows, total,
    );
  }

  // Flush judge cache to disk
  judgeCache?.flush();

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
  const passedAssertions = benchmarkCases.reduce(
    (s, c) => s + c.assertions.filter((a) => a.pass).length,
    0,
  );
  const benchmark: BenchmarkResult = {
    timestamp: new Date().toISOString(),
    model,
    skill_name: evalsFile.skill_name,
    cases: benchmarkCases,
    overall_pass_rate: totalAssertions > 0 ? passedAssertions / totalAssertions : 0,
  };

  await writeBenchmark(skillDir, benchmark);
  console.log(dim(`\nBenchmark written to ${skillDir}/evals/benchmark.json`));
}

// ---------------------------------------------------------------------------
// T-025: Resolve whether to use batch mode
// ---------------------------------------------------------------------------

function resolveBatchMode(batchFlag: boolean | undefined, provider: ProviderName): boolean {
  if (!batchFlag) return false;

  if (provider !== "anthropic") {
    console.warn(yellow("Batch mode only supported with anthropic provider, running sequentially"));
    return false;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(yellow("Batch mode requires ANTHROPIC_API_KEY, running sequentially"));
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sequential mode (existing behavior)
// ---------------------------------------------------------------------------

async function runSequentialMode(
  evalsFile: { evals: import("../../eval/schema.js").EvalCase[] },
  systemPrompt: string,
  client: LlmClient,
  effectiveJudgeClient: LlmClient,
  provider: ProviderName,
  judgeCache: import("../../eval/judge-cache.js").JudgeCache | null,
  progress: ProgressLog,
  benchmarkCases: BenchmarkCase[],
  tableRows: string[][],
  total: number,
): Promise<void> {
  for (let i = 0; i < evalsFile.evals.length; i++) {
    const evalCase = evalsFile.evals[i];
    const caseStart = Date.now();

    progress.update({
      currentCase: evalCase.name,
      phase: "generating",
      completedCases: i,
    });

    try {
      process.stdout.write(dim(`[${i + 1}/${total}] ${evalCase.name} — generating...`));
      const genResult = await client.generate(systemPrompt, evalCase.prompt);
      const genSec = ((Date.now() - caseStart) / 1000).toFixed(1);
      process.stdout.write(dim(` ${genSec}s`));

      progress.update({ phase: "judging" });
      process.stdout.write(dim(` judging ${evalCase.assertions.length} assertions...`));

      const assertionResults = [];
      let passCount = 0;

      for (const assertion of evalCase.assertions) {
        const judgeCall = () => judgeAssertion(genResult.text, assertion, client, effectiveJudgeClient);

        let result;
        if (judgeCache) {
          result = await judgeCache.getOrCompute(
            assertion.text,
            genResult.text,
            effectiveJudgeClient.model,
            judgeCall,
          );
          result = { ...result, id: assertion.id, text: assertion.text };
        } else {
          result = await judgeCall();
        }

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

      if (classified.category === "auth" || classified.category === "provider_unavailable") {
        console.log(red(`\nAborting remaining cases — ${classified.category} error is not recoverable.`));
        console.log(dim(`  ${classified.hint}\n`));
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// T-026: Batch mode — two-round execution
//   Round 1: Generate all outputs sequentially
//   Round 2: Submit all judge calls as a single batch
// ---------------------------------------------------------------------------

async function runBatchMode(
  evalsFile: { evals: import("../../eval/schema.js").EvalCase[] },
  systemPrompt: string,
  client: LlmClient,
  effectiveJudgeClient: LlmClient,
  provider: ProviderName,
  progress: ProgressLog,
  benchmarkCases: BenchmarkCase[],
  tableRows: string[][],
  total: number,
): Promise<void> {
  // Round 1: Generate all outputs
  console.log(bold("\n--- Round 1: Generating outputs ---\n"));

  interface GeneratedCase {
    evalCase: import("../../eval/schema.js").EvalCase;
    output: string;
    error?: string;
  }

  const generatedCases: GeneratedCase[] = [];

  for (let i = 0; i < evalsFile.evals.length; i++) {
    const evalCase = evalsFile.evals[i];
    const caseStart = Date.now();

    progress.update({
      currentCase: evalCase.name,
      phase: "generating",
      completedCases: i,
    });

    try {
      process.stdout.write(dim(`[${i + 1}/${total}] ${evalCase.name} — generating...`));
      const genResult = await client.generate(systemPrompt, evalCase.prompt);
      const genSec = ((Date.now() - caseStart) / 1000).toFixed(1);
      console.log(dim(` ${genSec}s`));

      generatedCases.push({ evalCase, output: genResult.text });
    } catch (err) {
      const classified = classifyError(err, provider);
      console.log(yellow(` error: ${classified.title}`));

      generatedCases.push({ evalCase, output: "", error: (err as Error).message });

      if (classified.category === "auth" || classified.category === "provider_unavailable") {
        console.log(red(`\nAborting generation — ${classified.category} error is not recoverable.`));
        break;
      }
    }
  }

  // Round 2: Collect all judge prompts and submit as single batch
  console.log(bold("\n--- Round 2: Batch judging assertions ---\n"));

  const batchRequests: BatchJudgeRequest[] = [];
  const caseIndexMap: Array<{ caseIdx: number; startIdx: number; count: number }> = [];

  for (let i = 0; i < generatedCases.length; i++) {
    const { evalCase, output, error } = generatedCases[i];

    if (error) {
      // Skip errored cases — already recorded
      benchmarkCases.push({
        eval_id: evalCase.id,
        eval_name: evalCase.name,
        status: "error",
        error_message: error,
        pass_rate: 0,
        assertions: [],
      });
      tableRows.push([evalCase.name, "-", dim("generation error"), yellow("ERROR")]);
      continue;
    }

    const startIdx = batchRequests.length;
    for (let j = 0; j < evalCase.assertions.length; j++) {
      batchRequests.push({
        evalId: String(evalCase.id),
        assertionIdx: j,
        assertion: evalCase.assertions[j],
        output,
      });
    }
    caseIndexMap.push({ caseIdx: i, startIdx, count: evalCase.assertions.length });
  }

  if (batchRequests.length === 0) {
    console.log(dim("No assertions to judge."));
    return;
  }

  console.log(dim(`Submitting ${batchRequests.length} judge calls as batch...`));

  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const judgeModel = effectiveJudgeClient.model;

  const { results: batchResults, costInfo } = await batchJudgeAssertions(
    batchRequests,
    client,
    effectiveJudgeClient,
    { apiKey, model: judgeModel },
  );

  // Map batch results back to per-case benchmark entries
  for (const { caseIdx, startIdx, count } of caseIndexMap) {
    const { evalCase } = generatedCases[caseIdx];
    const caseResults = batchResults.slice(startIdx, startIdx + count);

    let passCount = 0;
    for (const result of caseResults) {
      if (result.pass) passCount++;

      const truncatedText =
        result.text.length > 60
          ? result.text.slice(0, 57) + "..."
          : result.text;

      tableRows.push([
        evalCase.name,
        result.id,
        truncatedText,
        result.pass ? green("PASS") : red("FAIL"),
      ]);
    }

    const passRate = count > 0 ? passCount / count : 0;
    const allPassed = passCount === count;

    console.log(
      dim(`  ${evalCase.name}: `) +
      (allPassed ? green(`${passCount}/${count} passed`) : red(`${passCount}/${count} passed`)),
    );

    benchmarkCases.push({
      eval_id: evalCase.id,
      eval_name: evalCase.name,
      status: allPassed ? "pass" : "fail",
      error_message: null,
      pass_rate: passRate,
      assertions: caseResults,
    });
  }

  // T-027: Print batch cost summary
  if (costInfo) {
    console.log(
      dim(`\nBatch cost: $${costInfo.batchCost.toFixed(4)} (50% discount vs $${costInfo.sequentialCost.toFixed(4)} sequential)`),
    );
  }
}
