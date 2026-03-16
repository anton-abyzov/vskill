// ---------------------------------------------------------------------------
// sweep-runner.ts -- multi-model sweep orchestration + leaderboard storage
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName, LlmClient } from "../eval/llm.js";
import type { EvalCase } from "../eval/schema.js";
import type { BenchmarkResult, BenchmarkCase } from "../eval/benchmark.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelSpec {
  provider: ProviderName;
  model: string;
}

export interface ModelStats {
  mean: number;
  stddev: number;
}

export interface ModelResult {
  provider: string;
  model: string;
  passRate: ModelStats;
  rubricScore: ModelStats | null;
  duration: ModelStats;
  cost: { total: number; perCase: number };
  status: "complete" | "error";
  errorMessage: string | null;
  caseResults: BenchmarkCase[][];
}

export interface SweepResult {
  sweepId: string;
  timestamp: string;
  judge: string;
  runs: number;
  models: ModelResult[];
}

export interface SweepOpts {
  skillDir: string;
  skillName: string;
  systemPrompt: string;
  evalCases: EvalCase[];
  models: string[];
  judge: string;
  runs: number;
  concurrency: number;
}

export type SweepSSEEvent =
  | { type: "sweep_start"; data: { totalModels: number; runs: number; judge: string } }
  | { type: "sweep_model_start"; data: { model: string; provider: string; modelIndex: number; totalModels: number } }
  | { type: "sweep_model_progress"; data: { model: string; currentCase: number; totalCases: number; run: number; totalRuns: number; percentComplete: number } }
  | { type: "sweep_model_complete"; data: { model: string; provider: string; status: "complete" | "error"; passRate?: ModelStats; errorMessage?: string } }
  | { type: "sweep_complete"; data: SweepResult };

// ---------------------------------------------------------------------------
// Known providers for parsing model spec strings
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS: Set<string> = new Set([
  "anthropic", "openrouter", "ollama", "claude-cli", "codex-cli", "gemini-cli",
]);

/**
 * Parse a model spec string like "provider/model" or "provider/org/model".
 * Splits on the first `/` only — everything after is the model ID.
 */
export function parseModelSpec(spec: string): ModelSpec {
  const slashIdx = spec.indexOf("/");
  if (slashIdx === -1) {
    throw new Error(`Invalid model spec "${spec}": expected "provider/model" format`);
  }
  const provider = spec.slice(0, slashIdx);
  const model = spec.slice(slashIdx + 1);

  if (!model) {
    throw new Error(`Invalid model spec "${spec}": model name is empty`);
  }
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new Error(
      `Unknown provider "${provider}" in model spec "${spec}". Known providers: ${[...KNOWN_PROVIDERS].join(", ")}`,
    );
  }
  return { provider: provider as ProviderName, model };
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function computeStddev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function computeStats(values: number[]): ModelStats {
  const mean = computeMean(values);
  return { mean, stddev: computeStddev(values, mean) };
}

// ---------------------------------------------------------------------------
// Aggregate multiple benchmark runs into ModelResult stats
// ---------------------------------------------------------------------------

export function aggregateRuns(
  results: BenchmarkResult[],
  provider: string,
  model: string,
): Omit<ModelResult, "status" | "errorMessage"> {
  const passRates = results.map((r) => r.overall_pass_rate ?? 0);
  const durations = results.map((r) => r.totalDurationMs ?? 0);
  const costs = results.map((r) =>
    r.cases.reduce((sum, c) => sum + ((c as any).cost ?? 0), 0),
  );
  const totalCost = costs.reduce((s, c) => s + c, 0);
  const totalCases = results.reduce((s, r) => s + r.cases.length, 0);

  return {
    provider,
    model,
    passRate: computeStats(passRates),
    rubricScore: null,
    duration: computeStats(durations),
    cost: {
      total: totalCost,
      perCase: totalCases > 0 ? totalCost / totalCases : 0,
    },
    caseResults: results.map((r) => r.cases),
  };
}

// ---------------------------------------------------------------------------
// Sweep runner — yields SSE events as an async generator
// ---------------------------------------------------------------------------

export async function* runSweep(opts: SweepOpts): AsyncGenerator<SweepSSEEvent> {
  const { skillDir, skillName, systemPrompt, evalCases, models, judge, runs, concurrency } = opts;

  const modelSpecs = models.map(parseModelSpec);
  const judgeSpec = parseModelSpec(judge);

  yield {
    type: "sweep_start",
    data: { totalModels: modelSpecs.length, runs, judge },
  };

  const sweepResults: ModelResult[] = [];

  for (let mi = 0; mi < modelSpecs.length; mi++) {
    const spec = modelSpecs[mi];

    yield {
      type: "sweep_model_start",
      data: {
        model: spec.model,
        provider: spec.provider,
        modelIndex: mi,
        totalModels: modelSpecs.length,
      },
    };

    try {
      const client = createLlmClient({ provider: spec.provider, model: spec.model });
      const runResults: BenchmarkResult[] = [];

      for (let run = 0; run < runs; run++) {
        const cases: BenchmarkCase[] = [];

        for (let ci = 0; ci < evalCases.length; ci++) {
          const evalCase = evalCases[ci];
          const percentComplete = Math.round(
            ((mi * runs * evalCases.length + run * evalCases.length + ci + 1) /
              (modelSpecs.length * runs * evalCases.length)) * 100,
          );

          yield {
            type: "sweep_model_progress",
            data: {
              model: spec.model,
              currentCase: ci + 1,
              totalCases: evalCases.length,
              run: run + 1,
              totalRuns: runs,
              percentComplete,
            },
          };

          try {
            const genResult = await client.generate(systemPrompt, evalCase.prompt);
            // Create a basic benchmark case from the generation result
            const benchCase: BenchmarkCase = {
              eval_id: evalCase.id,
              eval_name: evalCase.name,
              status: "pass",
              error_message: null,
              pass_rate: 1,
              durationMs: genResult.durationMs,
              tokens: (genResult.inputTokens ?? 0) + (genResult.outputTokens ?? 0) || null,
              inputTokens: genResult.inputTokens,
              outputTokens: genResult.outputTokens,
              output: genResult.text,
              assertions: [],
            };
            // Attach cost if available
            (benchCase as any).cost = genResult.cost;

            // Judge assertions if a judge is configured
            if (evalCase.assertions.length > 0) {
              const judgeClient = createLlmClient({
                provider: judgeSpec.provider,
                model: judgeSpec.model,
              });
              const { judgeAssertion } = await import("../eval/judge.js");

              const assertionResults = await Promise.all(
                evalCase.assertions.map((a) =>
                  judgeAssertion(genResult.text, a, judgeClient),
                ),
              );
              benchCase.assertions = assertionResults;
              benchCase.pass_rate =
                assertionResults.length > 0
                  ? assertionResults.filter((a) => a.pass).length / assertionResults.length
                  : 0;
              benchCase.status = assertionResults.every((a) => a.pass) ? "pass" : "fail";
            }

            cases.push(benchCase);
          } catch (err) {
            cases.push({
              eval_id: evalCase.id,
              eval_name: evalCase.name,
              status: "error",
              error_message: err instanceof Error ? err.message : String(err),
              pass_rate: 0,
              assertions: [],
            });
          }
        }

        const totalAssertions = cases.reduce((s, c) => s + c.assertions.length, 0);
        const passedAssertions = cases.reduce(
          (s, c) => s + c.assertions.filter((a) => a.pass).length, 0,
        );

        runResults.push({
          timestamp: new Date().toISOString(),
          model: spec.model,
          skill_name: skillName,
          cases,
          overall_pass_rate: totalAssertions > 0 ? passedAssertions / totalAssertions : 0,
          type: "benchmark",
          provider: spec.provider,
          totalDurationMs: cases.reduce((s, c) => s + (c.durationMs ?? 0), 0),
          totalInputTokens: cases.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
          totalOutputTokens: cases.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
          scope: "bulk",
        });
      }

      const aggregated = aggregateRuns(runResults, spec.provider, spec.model);
      sweepResults.push({
        ...aggregated,
        status: "complete",
        errorMessage: null,
      });

      yield {
        type: "sweep_model_complete",
        data: {
          model: spec.model,
          provider: spec.provider,
          status: "complete",
          passRate: aggregated.passRate,
        },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      sweepResults.push({
        provider: spec.provider,
        model: spec.model,
        passRate: { mean: 0, stddev: 0 },
        rubricScore: null,
        duration: { mean: 0, stddev: 0 },
        cost: { total: 0, perCase: 0 },
        status: "error",
        errorMessage,
        caseResults: [],
      });

      yield {
        type: "sweep_model_complete",
        data: {
          model: spec.model,
          provider: spec.provider,
          status: "error",
          errorMessage,
        },
      };
    }
  }

  // Write leaderboard file
  const sweepResult: SweepResult = {
    sweepId: randomUUID(),
    timestamp: new Date().toISOString(),
    judge,
    runs,
    models: sweepResults,
  };

  await writeLeaderboard(skillDir, sweepResult);

  yield { type: "sweep_complete", data: sweepResult };
}

// ---------------------------------------------------------------------------
// Leaderboard storage
// ---------------------------------------------------------------------------

export async function writeLeaderboard(skillDir: string, result: SweepResult): Promise<string> {
  const leaderboardDir = join(skillDir, "evals", "leaderboard");
  await mkdir(leaderboardDir, { recursive: true });

  const filename = `${result.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = join(leaderboardDir, filename);
  await writeFile(filepath, JSON.stringify(result, null, 2));
  return filepath;
}

export async function listLeaderboard(skillDir: string, limit = 20): Promise<SweepResult[]> {
  const leaderboardDir = join(skillDir, "evals", "leaderboard");
  try {
    const files = await readdir(leaderboardDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();
    const entries: SweepResult[] = [];

    for (const file of jsonFiles.slice(0, limit)) {
      try {
        const content = await readFile(join(leaderboardDir, file), "utf-8");
        entries.push(JSON.parse(content));
      } catch {
        // Skip corrupted files
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export async function readLeaderboardEntry(
  skillDir: string,
  timestamp: string,
): Promise<SweepResult | null> {
  const leaderboardDir = join(skillDir, "evals", "leaderboard");
  try {
    const files = await readdir(leaderboardDir);
    const match = files.find((f) => f.includes(timestamp.replace(/[:.]/g, "-")));
    if (!match) return null;
    const content = await readFile(join(leaderboardDir, match), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
