// ---------------------------------------------------------------------------
// sweep-runner.ts -- multi-model sweep orchestration + leaderboard storage
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName, LlmClient } from "../eval/llm.js";
import { emitDataEvent } from "./data-events.js";
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
  median?: number;
  ci95?: [number, number]; // 95% confidence interval [lower, upper]
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
  // Baseline comparison (populated when --baseline is used)
  baselinePassRate?: ModelStats;
  skillDelta?: ModelStats;         // passRate - baselinePassRate
  amplificationPct?: number;       // (delta.mean / baseline.mean) * 100
  compositeScore?: number;         // weighted ranking score
}

export interface SweepResult {
  sweepId: string;
  timestamp: string;
  judge: string;
  runs: number;
  models: ModelResult[];
  baselineEnabled?: boolean;
  skillQualityScore?: number;       // median amplificationPct across models
  skillQualityRating?: "excellent" | "good" | "marginal" | "minimal" | "harmful";
  judgeBiasWarning?: string;        // set when judge matches a competitor model
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
  baseline?: boolean;
  baselinePrompt?: string; // defaults to "You are a helpful AI assistant."
}

export type SweepSSEEvent =
  | { type: "sweep_start"; data: { totalModels: number; runs: number; judge: string; baseline: boolean } }
  | { type: "sweep_model_start"; data: { model: string; provider: string; modelIndex: number; totalModels: number } }
  | { type: "sweep_model_progress"; data: { model: string; currentCase: number; totalCases: number; run: number; totalRuns: number; percentComplete: number; phase?: "skill" | "baseline" } }
  | { type: "sweep_model_complete"; data: { model: string; provider: string; status: "complete" | "error"; passRate?: ModelStats; baselinePassRate?: ModelStats; skillDelta?: ModelStats; amplificationPct?: number; errorMessage?: string } }
  | { type: "sweep_judge_bias_warning"; data: { judge: string; matchedModel: string; warning: string } }
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
  // Sample standard deviation (Bessel's correction: N-1)
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeCI95(values: number[]): [number, number] | undefined {
  if (values.length < 2) return undefined;
  const mean = computeMean(values);
  const stddev = computeStddev(values, mean);
  // t-distribution critical value for 95% CI (approximation for small samples)
  const tCritical = values.length <= 5 ? 2.776 : values.length <= 10 ? 2.262 : 1.96;
  const margin = tCritical * (stddev / Math.sqrt(values.length));
  // No clamping — CI is valid for any metric (pass rates, durations, costs)
  return [mean - margin, mean + margin];
}

export function computeStats(values: number[]): ModelStats {
  const mean = computeMean(values);
  return {
    mean,
    stddev: computeStddev(values, mean),
    median: computeMedian(values),
    ci95: computeCI95(values),
  };
}

// ---------------------------------------------------------------------------
// Judge bias detection
// ---------------------------------------------------------------------------

export interface JudgeBiasResult {
  warning: string;
  matchedModel: string;
}

export function detectJudgeBias(judgeSpec: string, modelSpecs: string[]): JudgeBiasResult | undefined {
  const judgeParts = judgeSpec.split("/");
  const judgeModel = judgeParts.slice(1).join("/").toLowerCase();
  const judgeProvider = judgeParts[0].toLowerCase();

  for (const spec of modelSpecs) {
    const parts = spec.split("/");
    const modelName = parts.slice(1).join("/").toLowerCase();
    const modelProvider = parts[0].toLowerCase();

    // Exact match
    if (judgeModel === modelName && judgeProvider === modelProvider) {
      return {
        warning: `Judge model "${judgeSpec}" is identical to competitor model "${spec}". Self-preference bias is likely. Consider using a different judge model.`,
        matchedModel: spec,
      };
    }
    // Same provider family (e.g., anthropic/claude-sonnet judging anthropic/claude-opus)
    if (judgeProvider === modelProvider && judgeModel !== modelName) {
      const extractFamily = (m: string) => m.split(/[-_]/)[0];
      const judgeFamily = extractFamily(judgeModel);
      const modelFamily = extractFamily(modelName);
      if (judgeFamily === modelFamily && judgeFamily.length > 0) {
        return {
          warning: `Judge "${judgeSpec}" is from the same model family as "${spec}". Family-preference bias is possible. Consider a judge from a different provider.`,
          matchedModel: spec,
        };
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Composite ranking score
// ---------------------------------------------------------------------------

export function computeCompositeScore(passRate: ModelStats, runs: number): number {
  const confidence = Math.min(1, runs / 5);
  const stability = 1 - Math.min(1, passRate.stddev * 5); // lower stddev = higher stability
  return passRate.mean * 0.7 + stability * 0.15 + confidence * 0.15;
}

// ---------------------------------------------------------------------------
// Skill quality score from amplification data
// ---------------------------------------------------------------------------

export type SkillQualityRating = "excellent" | "good" | "marginal" | "minimal" | "harmful";

export function computeSkillQualityScore(amplifications: number[]): { score: number; rating: SkillQualityRating } {
  if (amplifications.length === 0) return { score: 0, rating: "minimal" };
  const score = computeMedian(amplifications);
  let rating: SkillQualityRating;
  if (score >= 20) rating = "excellent";
  else if (score >= 10) rating = "good";
  else if (score >= 5) rating = "marginal";
  else if (score >= 0) rating = "minimal";
  else rating = "harmful";
  return { score, rating };
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
    r.cases.reduce((sum, c) => sum + (c.cost ?? 0), 0),
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

/**
 * Run a single model through all eval cases with a given system prompt.
 * Returns aggregated BenchmarkResult[] (one per run).
 */
async function* runModelCases(
  client: ReturnType<typeof createLlmClient>,
  judgeSpec: ModelSpec,
  systemPrompt: string,
  evalCases: EvalCase[],
  skillName: string,
  spec: ModelSpec,
  runs: number,
  modelIndex: number,
  totalModels: number,
  totalPhases: number,
  phaseOffset: number,
  phase: "skill" | "baseline",
): AsyncGenerator<SweepSSEEvent, BenchmarkResult[]> {
  const runResults: BenchmarkResult[] = [];
  const totalSteps = totalModels * totalPhases * runs * evalCases.length;

  // Hoist judge client and import outside the hot loop
  const needsJudge = evalCases.some((c) => c.assertions.length > 0);
  const judgeClient = needsJudge
    ? createLlmClient({ provider: judgeSpec.provider, model: judgeSpec.model })
    : null;
  const judgeModule = needsJudge ? await import("../eval/judge.js") : null;

  for (let run = 0; run < runs; run++) {
    const cases: BenchmarkCase[] = [];

    for (let ci = 0; ci < evalCases.length; ci++) {
      const evalCase = evalCases[ci];
      const step = modelIndex * totalPhases * runs * evalCases.length
        + phaseOffset * runs * evalCases.length
        + run * evalCases.length + ci + 1;
      const percentComplete = Math.round((step / totalSteps) * 100);

      yield {
        type: "sweep_model_progress",
        data: {
          model: spec.model,
          currentCase: ci + 1,
          totalCases: evalCases.length,
          run: run + 1,
          totalRuns: runs,
          percentComplete,
          phase,
        },
      };

      try {
        const genResult = await client.generate(systemPrompt, evalCase.prompt);
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
          cost: genResult.cost,
          billingMode: genResult.billingMode,
          output: genResult.text,
          assertions: [],
        };

        if (evalCase.assertions.length > 0 && judgeClient && judgeModule) {

          const assertionResults = await Promise.all(
            evalCase.assertions.map((a) =>
              judgeModule.judgeAssertion(genResult.text, a, judgeClient),
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

  return runResults;
}

export async function* runSweep(opts: SweepOpts): AsyncGenerator<SweepSSEEvent> {
  const { skillDir, skillName, systemPrompt, evalCases, models, judge, runs, concurrency } = opts;
  const baseline = opts.baseline ?? false;
  const baselinePrompt = opts.baselinePrompt ?? "You are a helpful AI assistant.";

  const modelSpecs = models.map(parseModelSpec);
  const judgeSpec = parseModelSpec(judge);
  const totalPhases = baseline ? 2 : 1;

  // Judge bias detection
  const judgeBias = detectJudgeBias(judge, models);
  if (judgeBias) {
    yield {
      type: "sweep_judge_bias_warning",
      data: { judge, matchedModel: judgeBias.matchedModel, warning: judgeBias.warning },
    };
  }

  yield {
    type: "sweep_start",
    data: { totalModels: modelSpecs.length, runs, judge, baseline },
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

      // Phase 1: Run WITH skill prompt
      const skillGen = runModelCases(
        client, judgeSpec, systemPrompt, evalCases, skillName,
        spec, runs, mi, modelSpecs.length, totalPhases, 0, "skill",
      );
      let skillRunResults: BenchmarkResult[] = [];
      let next = await skillGen.next();
      while (!next.done) {
        yield next.value;
        next = await skillGen.next();
      }
      skillRunResults = next.value;

      const aggregated = aggregateRuns(skillRunResults, spec.provider, spec.model);
      const modelResult: ModelResult = {
        ...aggregated,
        compositeScore: computeCompositeScore(aggregated.passRate, runs),
        status: "complete",
        errorMessage: null,
      };

      // Phase 2: Run WITHOUT skill prompt (baseline)
      if (baseline) {
        const baselineGen = runModelCases(
          client, judgeSpec, baselinePrompt, evalCases, skillName,
          spec, runs, mi, modelSpecs.length, totalPhases, 1, "baseline",
        );
        let baselineRunResults: BenchmarkResult[] = [];
        let bNext = await baselineGen.next();
        while (!bNext.done) {
          yield bNext.value;
          bNext = await baselineGen.next();
        }
        baselineRunResults = bNext.value;

        const baselineAgg = aggregateRuns(baselineRunResults, spec.provider, spec.model);
        modelResult.baselinePassRate = baselineAgg.passRate;

        // Compute skill delta
        const deltaValues = skillRunResults.map((sr, i) => {
          const br = baselineRunResults[i];
          return (sr.overall_pass_rate ?? 0) - (br?.overall_pass_rate ?? 0);
        });
        modelResult.skillDelta = computeStats(deltaValues);

        // Compute amplification percentage (undefined when baseline is 0 — can't divide)
        const baselineMean = baselineAgg.passRate.mean;
        modelResult.amplificationPct = baselineMean > 0
          ? ((aggregated.passRate.mean - baselineMean) / baselineMean) * 100
          : undefined;
      }

      sweepResults.push(modelResult);

      yield {
        type: "sweep_model_complete",
        data: {
          model: spec.model,
          provider: spec.provider,
          status: "complete",
          passRate: aggregated.passRate,
          baselinePassRate: modelResult.baselinePassRate,
          skillDelta: modelResult.skillDelta,
          amplificationPct: modelResult.amplificationPct,
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

  // Compute skill quality score if baseline was enabled
  let skillQualityScore: number | undefined;
  let skillQualityRating: SkillQualityRating | undefined;
  if (baseline) {
    const amplifications = sweepResults
      .filter((m) => m.status === "complete" && m.amplificationPct != null && isFinite(m.amplificationPct!))
      .map((m) => m.amplificationPct!);
    if (amplifications.length > 0) {
      const quality = computeSkillQualityScore(amplifications);
      skillQualityScore = quality.score;
      skillQualityRating = quality.rating;
    }
  }

  // Write leaderboard file
  const sweepResult: SweepResult = {
    sweepId: randomUUID(),
    timestamp: new Date().toISOString(),
    judge,
    runs,
    models: sweepResults,
    baselineEnabled: baseline || undefined,
    skillQualityScore,
    skillQualityRating,
    judgeBiasWarning: judgeBias?.warning,
  };

  await writeLeaderboard(skillDir, sweepResult);
  emitDataEvent("leaderboard:updated");

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
