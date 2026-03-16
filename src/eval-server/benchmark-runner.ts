// ---------------------------------------------------------------------------
// benchmark-runner.ts -- SSE benchmark execution (single-case + bulk)
// ---------------------------------------------------------------------------

import type * as http from "node:http";
import type { EvalCase } from "../eval/schema.js";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "../eval/benchmark.js";
import type { LlmClient, ProviderName } from "../eval/llm.js";
import { estimateDurationSec, createLlmClient } from "../eval/llm.js";
import { judgeAssertion } from "../eval/judge.js";
import type { JudgeCache } from "../eval/judge-cache.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";
import { sendSSE, sendSSEDone, withHeartbeat } from "./sse-helpers.js";
import { classifyError } from "./error-classifier.js";
import { Semaphore } from "./concurrency.js";

// ---------------------------------------------------------------------------
// CLI providers that spawn child processes — default concurrency 1
// ---------------------------------------------------------------------------

const CLI_PROVIDERS = new Set<string>(["claude-cli", "codex-cli", "gemini-cli"]);

function defaultConcurrency(provider: string): number {
  return CLI_PROVIDERS.has(provider) ? 1 : 5;
}

// ---------------------------------------------------------------------------
// 429 retry helper — exponential backoff (1s, 2s, 4s), max 3 retries
// ---------------------------------------------------------------------------

function is429(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("Rate limit")) return true;
    if ("status" in err && (err as any).status === 429) return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Weak-model judge warning heuristic
// ---------------------------------------------------------------------------

const MODEL_STRENGTH: Record<string, number> = {
  haiku: 1,
  flash: 1,
  "mini": 1,
  sonnet: 2,
  pro: 2,
  opus: 3,
};

function estimateStrength(model: string): number {
  const lower = model.toLowerCase();
  for (const [key, strength] of Object.entries(MODEL_STRENGTH)) {
    if (lower.includes(key)) return strength;
  }
  return 2; // unknown = medium
}

export function checkWeakJudgeWarning(generatorModel: string, judgeModel: string): string | null {
  const genStrength = estimateStrength(generatorModel);
  const judgeStrength = estimateStrength(judgeModel);
  if (judgeStrength < genStrength) {
    return `Warning: Judge model "${judgeModel}" appears weaker than generator "${generatorModel}". Judge scores may be less reliable.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-case execution (used by per-case endpoint and bulk runner)
// ---------------------------------------------------------------------------

export interface SingleCaseRunOptions {
  res: http.ServerResponse;
  evalCase: EvalCase;
  systemPrompt: string;
  client: LlmClient;
  judgeClient?: LlmClient;
  judgeCache?: JudgeCache;
  isAborted: () => boolean;
  totalCases?: number; // for progress display
  provider?: string;   // for error classification hints
}

export async function runSingleCaseSSE(opts: SingleCaseRunOptions): Promise<BenchmarkCase> {
  const { res, evalCase, systemPrompt, client, judgeClient, judgeCache, isAborted, totalCases = 1, provider } = opts;
  const effectiveJudgeClient = judgeClient ?? client;
  let sequence = 0;

  const emitSSE = (event: string, data: Record<string, unknown>) => {
    sendSSE(res, event, { ...data, caseId: evalCase.id, sequence: sequence++ });
  };

  emitSSE("case_start", {
    eval_id: evalCase.id,
    eval_name: evalCase.name,
    total: totalCases,
  });

  emitSSE("progress", {
    eval_id: evalCase.id,
    phase: "generating",
    message: `Generating LLM response for "${evalCase.name}"...`,
  });

  try {
    // Retry with exponential backoff on 429
    let genResult;
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        genResult = await withHeartbeat(
          res, evalCase.id, "generating",
          `Generating LLM response for "${evalCase.name}"...`,
          () => client.generate(systemPrompt, evalCase.prompt),
        );
        break;
      } catch (err) {
        if (is429(err) && attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAYS[attempt];
          emitSSE("warning", {
            eval_id: evalCase.id,
            message: `Rate limited (429). Retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
            attempt: attempt + 1,
            delayMs,
          });
          await sleep(delayMs);
          continue;
        }
        throw err;
      }
    }

    const totalTokens = genResult.inputTokens != null && genResult.outputTokens != null
      ? genResult.inputTokens + genResult.outputTokens
      : null;

    emitSSE("output_ready", {
      eval_id: evalCase.id,
      output: genResult.text,
      durationMs: genResult.durationMs,
      tokens: totalTokens,
    });

    emitSSE("progress", {
      eval_id: evalCase.id,
      phase: "judging",
      message: `Evaluating ${evalCase.assertions.length} assertion${evalCase.assertions.length !== 1 ? "s" : ""}...`,
      total: evalCase.assertions.length,
    });

    // T-003: Parallelize intra-case assertion judges via Promise.all
    const assertionResults: BenchmarkAssertionResult[] = await Promise.all(
      evalCase.assertions.map(async (assertion, ai) => {
        if (isAborted()) {
          return { id: assertion.id, text: assertion.text, pass: false, reasoning: "aborted" };
        }

        const judgeCall = () => judgeAssertion(genResult.text, assertion, client, effectiveJudgeClient);

        let result;
        if (judgeCache) {
          result = await judgeCache.getOrCompute(
            assertion.text,
            genResult.text,
            effectiveJudgeClient.model,
            judgeCall,
          );
        } else {
          result = await judgeCall();
        }

        emitSSE("assertion_result", {
          eval_id: evalCase.id,
          assertion_id: result.id,
          text: result.text,
          pass: result.pass,
          reasoning: result.reasoning,
          assertion_index: ai,
        });

        return result;
      }),
    );

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

    emitSSE("case_complete", {
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
    emitSSE("case_complete", {
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
  judgeClient?: LlmClient;
  judgeCache?: JudgeCache;
  isAborted: () => boolean;
  concurrency?: number;
}

export async function runBenchmarkSSE(opts: BenchmarkRunOptions): Promise<void> {
  const {
    res, skillDir, skillName, systemPrompt, runType, provider,
    evalCases: allCases, filterIds, client, judgeClient, judgeCache, isAborted,
    concurrency: concurrencyOverride,
  } = opts;

  const evalCases = filterIds
    ? allCases.filter((e) => filterIds.has(e.id))
    : allCases;

  const concurrency = concurrencyOverride ?? defaultConcurrency(provider);

  // Emit duration estimate so the UI can warn about long runs
  const totalAssertions = evalCases.reduce((s, e) => s + e.assertions.length, 0);
  const estimate = estimateDurationSec(provider as ProviderName, evalCases.length, totalAssertions);
  sendSSE(res, "estimate", {
    totalCases: evalCases.length,
    totalAssertions,
    estimatedMinSec: estimate.minSec,
    estimatedMaxSec: estimate.maxSec,
    estimatedLabel: estimate.label,
    concurrency,
  });

  // Emit weak-model judge warning if applicable
  if (judgeClient) {
    const warning = checkWeakJudgeWarning(client.model, judgeClient.model);
    if (warning) {
      console.warn(warning);
      sendSSE(res, "warning", { message: warning });
    }
  }

  // T-001: Parallel case execution via Semaphore + Promise.allSettled
  const semaphore = new Semaphore(concurrency);

  const caseTasks = evalCases.map((evalCase) => async () => {
    if (isAborted()) return null;
    await semaphore.acquire();
    try {
      return await runSingleCaseSSE({
        res,
        evalCase,
        systemPrompt,
        client,
        judgeClient,
        judgeCache,
        isAborted,
        totalCases: evalCases.length,
        provider,
      });
    } finally {
      semaphore.release();
    }
  });

  const settled = await Promise.allSettled(caseTasks.map((fn) => fn()));

  const cases: BenchmarkCase[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value != null) {
      cases.push(result.value);
    } else if (result.status === "rejected") {
      // Shouldn't normally happen since runSingleCaseSSE catches errors,
      // but handle as safety net
      cases.push({
        eval_id: -1,
        eval_name: "unknown",
        status: "error",
        error_message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        pass_rate: 0,
        assertions: [],
      });
    }
  }

  const bulkResult = assembleBulkResult(cases, { model: client.model, skillName, runType, provider });

  if (!isAborted()) {
    // Save history for bulk runs (single-case runs save via per-case endpoint)
    if (!filterIds) {
      await writeHistoryEntry(skillDir, bulkResult);
    }
    sendSSEDone(res, bulkResult);
  }
}
