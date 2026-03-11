// ---------------------------------------------------------------------------
// benchmark-runner.ts -- SSE benchmark execution (single-case + bulk)
// ---------------------------------------------------------------------------

import type * as http from "node:http";
import type { EvalCase } from "../eval/schema.js";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "../eval/benchmark.js";
import type { LlmClient, ProviderName } from "../eval/llm.js";
import { estimateDurationSec } from "../eval/llm.js";
import { judgeAssertion } from "../eval/judge.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";
import { sendSSE, sendSSEDone, withHeartbeat } from "./sse-helpers.js";
import { classifyError } from "./error-classifier.js";

// ---------------------------------------------------------------------------
// Single-case execution (used by per-case endpoint and bulk runner)
// ---------------------------------------------------------------------------

export interface SingleCaseRunOptions {
  res: http.ServerResponse;
  evalCase: EvalCase;
  systemPrompt: string;
  client: LlmClient;
  isAborted: () => boolean;
  totalCases?: number; // for progress display
  provider?: string;   // for error classification hints
}

export async function runSingleCaseSSE(opts: SingleCaseRunOptions): Promise<BenchmarkCase> {
  const { res, evalCase, systemPrompt, client, isAborted, totalCases = 1, provider } = opts;

  sendSSE(res, "case_start", {
    eval_id: evalCase.id,
    eval_name: evalCase.name,
    total: totalCases,
  });

  sendSSE(res, "progress", {
    eval_id: evalCase.id,
    phase: "generating",
    message: `Generating LLM response for "${evalCase.name}"...`,
  });

  try {
    const genResult = await withHeartbeat(
      res, evalCase.id, "generating",
      `Generating LLM response for "${evalCase.name}"...`,
      () => client.generate(systemPrompt, evalCase.prompt),
    );
    const totalTokens = genResult.inputTokens != null && genResult.outputTokens != null
      ? genResult.inputTokens + genResult.outputTokens
      : null;

    sendSSE(res, "output_ready", {
      eval_id: evalCase.id,
      output: genResult.text,
      durationMs: genResult.durationMs,
      tokens: totalTokens,
    });

    sendSSE(res, "progress", {
      eval_id: evalCase.id,
      phase: "judging",
      message: `Evaluating ${evalCase.assertions.length} assertion${evalCase.assertions.length !== 1 ? "s" : ""}...`,
      total: evalCase.assertions.length,
    });

    const assertionResults: BenchmarkAssertionResult[] = [];

    for (let ai = 0; ai < evalCase.assertions.length; ai++) {
      const assertion = evalCase.assertions[ai];

      sendSSE(res, "progress", {
        eval_id: evalCase.id,
        phase: "judging_assertion",
        message: `Evaluating assertion ${ai + 1}/${evalCase.assertions.length}: "${assertion.text.slice(0, 60)}${assertion.text.length > 60 ? "..." : ""}"`,
        current: ai + 1,
        total: evalCase.assertions.length,
        assertion_id: assertion.id,
      });
      if (isAborted()) break;
      const result = await judgeAssertion(genResult.text, assertion, client);
      assertionResults.push(result);
      sendSSE(res, "assertion_result", {
        eval_id: evalCase.id,
        assertion_id: result.id,
        text: result.text,
        pass: result.pass,
        reasoning: result.reasoning,
      });
    }

    const passRate =
      assertionResults.length > 0
        ? assertionResults.filter((a) => a.pass).length / assertionResults.length
        : 0;
    const status = assertionResults.length > 0 && assertionResults.every((a) => a.pass) ? "pass" : "fail";

    const benchCase: BenchmarkCase = {
      eval_id: evalCase.id,
      eval_name: evalCase.name,
      status: status as "pass" | "fail",
      error_message: null,
      pass_rate: passRate,
      durationMs: genResult.durationMs,
      tokens: totalTokens,
      inputTokens: genResult.inputTokens,
      outputTokens: genResult.outputTokens,
      output: genResult.text,
      assertions: assertionResults,
    };

    sendSSE(res, "case_complete", {
      eval_id: evalCase.id,
      status,
      pass_rate: passRate,
      durationMs: genResult.durationMs,
      tokens: totalTokens,
    });

    return benchCase;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const classified = classifyError(err, provider);
    const errorCase: BenchmarkCase = {
      eval_id: evalCase.id,
      eval_name: evalCase.name,
      status: "error",
      error_message: errorMsg,
      pass_rate: 0,
      assertions: [],
    };
    sendSSE(res, "case_complete", {
      eval_id: evalCase.id,
      status: "error",
      error_message: errorMsg,
      classified_error: classified,
    });
    return errorCase;
  }
}

// ---------------------------------------------------------------------------
// Assemble bulk result from individual case results
// ---------------------------------------------------------------------------

export function assembleBulkResult(
  cases: BenchmarkCase[],
  meta: { model: string; skillName: string; runType: "benchmark" | "baseline"; provider: string },
): BenchmarkResult {
  const totalAssertions = cases.reduce((s, c) => s + c.assertions.length, 0);
  const passedAssertions = cases.reduce(
    (s, c) => s + c.assertions.filter((a) => a.pass).length,
    0,
  );
  const totalDurationMs = cases.reduce((s, c) => s + (c.durationMs ?? 0), 0);
  const hasTokens = cases.some((c) => c.inputTokens != null);

  return {
    timestamp: new Date().toISOString(),
    model: meta.model,
    skill_name: meta.skillName,
    cases,
    overall_pass_rate: totalAssertions > 0 ? passedAssertions / totalAssertions : 0,
    type: meta.runType,
    provider: meta.provider,
    totalDurationMs,
    totalInputTokens: hasTokens ? cases.reduce((s, c) => s + (c.inputTokens ?? 0), 0) : null,
    totalOutputTokens: hasTokens ? cases.reduce((s, c) => s + (c.outputTokens ?? 0), 0) : null,
    scope: "bulk",
  };
}

// ---------------------------------------------------------------------------
// Bulk SSE benchmark (existing API, now uses runSingleCaseSSE internally)
// ---------------------------------------------------------------------------

export interface BenchmarkRunOptions {
  res: http.ServerResponse;
  skillDir: string;
  skillName: string;
  systemPrompt: string;
  runType: "benchmark" | "baseline";
  provider: string;
  evalCases: EvalCase[];
  filterIds: Set<number> | null;
  client: LlmClient;
  isAborted: () => boolean;
}

export async function runBenchmarkSSE(opts: BenchmarkRunOptions): Promise<void> {
  const {
    res, skillDir, skillName, systemPrompt, runType, provider,
    evalCases: allCases, filterIds, client, isAborted,
  } = opts;

  const evalCases = filterIds
    ? allCases.filter((e) => filterIds.has(e.id))
    : allCases;

  // Emit duration estimate so the UI can warn about long runs
  const totalAssertions = evalCases.reduce((s, e) => s + e.assertions.length, 0);
  const estimate = estimateDurationSec(provider as ProviderName, evalCases.length, totalAssertions);
  sendSSE(res, "estimate", {
    totalCases: evalCases.length,
    totalAssertions,
    estimatedMinSec: estimate.minSec,
    estimatedMaxSec: estimate.maxSec,
    estimatedLabel: estimate.label,
  });

  const cases: BenchmarkCase[] = [];

  for (const evalCase of evalCases) {
    if (isAborted()) break;

    const benchCase = await runSingleCaseSSE({
      res,
      evalCase,
      systemPrompt,
      client,
      isAborted,
      totalCases: evalCases.length,
      provider,
    });
    cases.push(benchCase);
  }

  const result = assembleBulkResult(cases, { model: client.model, skillName, runType, provider });

  if (!isAborted()) {
    // Save history for bulk runs (single-case runs save via per-case endpoint)
    if (!filterIds) {
      await writeHistoryEntry(skillDir, result);
    }
    sendSSEDone(res, result);
  }
}
