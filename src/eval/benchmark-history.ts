// ---------------------------------------------------------------------------
// benchmark-history.ts -- timestamped benchmark history with regression diffing
// ---------------------------------------------------------------------------

import { readdir, readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "./benchmark.js";
import { writeBenchmark } from "./benchmark.js";

export interface HistorySummary {
  timestamp: string;
  filename: string;
  model: string;
  skillName: string;
  passRate: number;
  type: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  caseCount: number;
  totalDurationMs: number;
  totalTokens: number | null;
  totalCost?: number | null;
  provider?: string;
  verdict?: string;
}

export interface HistoryFilter {
  model?: string;
  type?: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
}

export interface CaseHistoryEntry {
  timestamp: string;
  model: string;
  type: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  provider?: string;
  pass_rate: number;
  durationMs?: number;
  tokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  assertions: BenchmarkAssertionResult[];
  baselinePassRate?: number;
}

export interface RegressionEntry {
  assertionId: string;
  evalId: number;
  evalName: string;
  previousStatus: boolean;
  currentStatus: boolean;
  change: "regression" | "improvement";
}

function toFilesafeTimestamp(iso: string): string {
  return iso.replace(/:/g, "-");
}

function fromFilesafeTimestamp(filename: string): string {
  // filename: 2026-03-08T12-00-00.000Z.json
  const ts = filename.replace(/\.json$/, "");
  // Restore colons in time portion: T12-00-00 -> T12:00:00
  return ts.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
}

export async function writeHistoryEntry(
  skillDir: string,
  result: BenchmarkResult & { type?: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate" },
): Promise<string> {
  const historyDir = join(skillDir, "evals", "history");
  await mkdir(historyDir, { recursive: true });

  const timestamp = result.timestamp || new Date().toISOString();
  const filename = `${toFilesafeTimestamp(timestamp)}.json`;
  const filepath = join(historyDir, filename);

  await writeFile(filepath, JSON.stringify(result, null, 2));

  // Also write latest benchmark.json for backward compat
  await writeBenchmark(skillDir, result);

  return filename;
}

export async function deleteHistoryEntry(
  skillDir: string,
  timestamp: string,
): Promise<boolean> {
  const historyDir = join(skillDir, "evals", "history");
  const filename = `${toFilesafeTimestamp(timestamp)}.json`;
  try {
    await unlink(join(historyDir, filename));
    return true;
  } catch {
    return false;
  }
}

export async function listHistory(
  skillDir: string,
  filter?: HistoryFilter,
): Promise<HistorySummary[]> {
  const historyDir = join(skillDir, "evals", "history");
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch {
    return [];
  }

  let jsonFiles = files.filter((f) => f.endsWith(".json")).sort().reverse();

  // Pre-filter by date range using filename timestamps (fast, no JSON parse)
  if (filter?.from || filter?.to) {
    const fromSafe = filter.from ? toFilesafeTimestamp(filter.from) : undefined;
    const toSafe = filter.to ? toFilesafeTimestamp(filter.to) : undefined;
    jsonFiles = jsonFiles.filter((f) => {
      const ts = f.replace(/\.json$/, "");
      if (fromSafe && ts < fromSafe) return false;
      if (toSafe && ts > toSafe) return false;
      return true;
    });
  }

  const entries: HistorySummary[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(historyDir, file), "utf-8");
      const data = JSON.parse(content) as BenchmarkResult & { type?: string };

      const entryType = (data.type as HistorySummary["type"]) || "benchmark";

      // Post-filter by model and type
      if (filter?.model && data.model !== filter.model) continue;
      if (filter?.type && entryType !== filter.type) continue;

      const totalAssertions = data.cases.reduce((sum, c) => sum + c.assertions.length, 0);
      const passedAssertions = data.cases.reduce(
        (sum, c) => sum + c.assertions.filter((a) => a.pass).length,
        0,
      );
      const totalDurationMs = data.cases.reduce((s, c) => s + (c.durationMs ?? 0), 0);
      const hasTokens = data.cases.some((c) => c.tokens != null);
      const totalTokens = hasTokens
        ? data.cases.reduce((s, c) => s + (c.tokens ?? 0), 0)
        : null;

      const hasCost = data.cases.some((c: BenchmarkCase) => c.cost != null) || (data as any).totalCost != null;
      const totalCost = hasCost
        ? (data as any).totalCost ?? data.cases.reduce((s: number, c: BenchmarkCase) => s + (c.cost ?? 0), 0)
        : null;

      entries.push({
        timestamp: fromFilesafeTimestamp(file),
        filename: file,
        model: data.model,
        skillName: data.skill_name,
        passRate: totalAssertions > 0 ? passedAssertions / totalAssertions : 0,
        type: entryType,
        caseCount: data.cases.length,
        totalDurationMs,
        totalTokens,
        totalCost,
        provider: data.provider,
        verdict: data.verdict,
      });
    } catch {
      // Skip malformed files
    }
  }
  return entries;
}

export async function readHistoryEntry(
  skillDir: string,
  timestamp: string,
): Promise<BenchmarkResult | null> {
  const historyDir = join(skillDir, "evals", "history");
  const filename = `${toFilesafeTimestamp(timestamp)}.json`;
  try {
    const content = await readFile(join(historyDir, filename), "utf-8");
    return JSON.parse(content) as BenchmarkResult;
  } catch {
    return null;
  }
}

export async function getCaseHistory(
  skillDir: string,
  evalId: number,
  filter?: { model?: string },
): Promise<CaseHistoryEntry[]> {
  const historyDir = join(skillDir, "evals", "history");
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch {
    return [];
  }

  const entries: CaseHistoryEntry[] = [];
  for (const file of files.filter((f) => f.endsWith(".json")).sort().reverse()) {
    try {
      const content = await readFile(join(historyDir, file), "utf-8");
      const data = JSON.parse(content) as BenchmarkResult & { type?: string };

      if (filter?.model && data.model !== filter.model) continue;

      const matchingCase = data.cases.find((c) => c.eval_id === evalId);
      if (!matchingCase) continue;

      const cd = matchingCase.comparisonDetail;
      const baselinePassRate = cd &&
        cd.baselineContentScore != null &&
        cd.baselineStructureScore != null
          ? (cd.baselineContentScore + cd.baselineStructureScore) / 200
          : undefined;

      entries.push({
        timestamp: fromFilesafeTimestamp(file),
        model: data.model,
        type: (data.type as CaseHistoryEntry["type"]) || "benchmark",
        provider: data.provider,
        pass_rate: matchingCase.pass_rate,
        durationMs: matchingCase.durationMs,
        tokens: matchingCase.tokens,
        inputTokens: matchingCase.inputTokens,
        outputTokens: matchingCase.outputTokens,
        assertions: matchingCase.assertions,
        baselinePassRate,
      });
    } catch {
      // Skip malformed files
    }
  }
  return entries;
}

export interface StatsResult {
  totalRuns: number;
  totalCost: number | null;
  costPerRun: number | null;
  assertionStats: Array<{
    id: string;
    text: string;
    passRate: number;
    totalRuns: number;
    evalId: number;
    evalName: string;
  }>;
  modelStats: Array<{
    model: string;
    runs: number;
    avgPassRate: number;
    avgDurationMs: number;
    avgCost: number | null;
  }>;
  trendPoints: Array<{
    timestamp: string;
    passRate: number;
    model: string;
    cost?: number | null;
  }>;
}

export async function computeStats(skillDir: string): Promise<StatsResult> {
  const historyDir = join(skillDir, "evals", "history");
  let files: string[];
  try {
    files = await readdir(historyDir);
  } catch {
    return { totalRuns: 0, totalCost: null, costPerRun: null, assertionStats: [], modelStats: [], trendPoints: [] };
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

  // Per-assertion tracking: key = "evalId:assertionId"
  const assertionMap = new Map<string, { id: string; text: string; passes: number; total: number; evalId: number; evalName: string }>();
  // Per-model tracking
  const modelMap = new Map<string, { runs: number; totalPassRate: number; totalDurationMs: number; totalCost: number; hasCost: boolean }>();
  // Trend points
  const trendPoints: StatsResult["trendPoints"] = [];
  let globalTotalCost = 0;
  let globalHasCost = false;

  for (const file of jsonFiles) {
    try {
      const content = await readFile(join(historyDir, file), "utf-8");
      const data = JSON.parse(content) as BenchmarkResult & { type?: string };
      const entryType = data.type || "benchmark";
      if (entryType !== "benchmark") continue; // Only count benchmark runs for stats

      const totalAssertions = data.cases.reduce((s, c) => s + c.assertions.length, 0);
      const passedAssertions = data.cases.reduce((s, c) => s + c.assertions.filter((a) => a.pass).length, 0);
      const passRate = totalAssertions > 0 ? passedAssertions / totalAssertions : 0;
      const totalDurationMs = data.cases.reduce((s, c) => s + (c.durationMs ?? 0), 0);

      // Cost aggregation
      const runHasCost = data.cases.some((c) => c.cost != null) || data.totalCost != null;
      const runCost = data.totalCost ?? (runHasCost ? data.cases.reduce((s, c) => s + (c.cost ?? 0), 0) : 0);
      if (runHasCost) {
        globalHasCost = true;
        globalTotalCost += runCost;
      }

      // Trend
      trendPoints.push({
        timestamp: fromFilesafeTimestamp(file),
        passRate,
        model: data.model,
        cost: runHasCost ? runCost : null,
      });

      // Model stats
      const existing = modelMap.get(data.model) || { runs: 0, totalPassRate: 0, totalDurationMs: 0, totalCost: 0, hasCost: false };
      existing.runs++;
      existing.totalPassRate += passRate;
      existing.totalDurationMs += totalDurationMs;
      if (runHasCost) {
        existing.hasCost = true;
        existing.totalCost += runCost;
      }
      modelMap.set(data.model, existing);

      // Per-assertion stats
      for (const c of data.cases) {
        for (const a of c.assertions) {
          const key = `${c.eval_id}:${a.id}`;
          const stat = assertionMap.get(key) || { id: a.id, text: a.text, passes: 0, total: 0, evalId: c.eval_id, evalName: c.eval_name };
          stat.total++;
          if (a.pass) stat.passes++;
          // Keep latest text
          stat.text = a.text;
          assertionMap.set(key, stat);
        }
      }
    } catch {
      // Skip malformed files
    }
  }

  const assertionStats = Array.from(assertionMap.values())
    .map((s) => ({
      id: s.id,
      text: s.text,
      passRate: s.total > 0 ? s.passes / s.total : 0,
      totalRuns: s.total,
      evalId: s.evalId,
      evalName: s.evalName,
    }))
    .sort((a, b) => a.passRate - b.passRate); // Worst-performing first

  const modelStats = Array.from(modelMap.entries())
    .map(([model, s]) => ({
      model,
      runs: s.runs,
      avgPassRate: s.runs > 0 ? s.totalPassRate / s.runs : 0,
      avgDurationMs: s.runs > 0 ? s.totalDurationMs / s.runs : 0,
      avgCost: s.hasCost && s.runs > 0 ? s.totalCost / s.runs : null,
    }))
    .sort((a, b) => b.avgPassRate - a.avgPassRate);

  const totalCost = globalHasCost ? globalTotalCost : null;
  const costPerRun = globalHasCost && trendPoints.length > 0 ? globalTotalCost / trendPoints.length : null;

  return {
    totalRuns: trendPoints.length,
    totalCost,
    costPerRun,
    assertionStats,
    modelStats,
    trendPoints,
  };
}

export function computeRegressions(
  current: BenchmarkResult,
  previous: BenchmarkResult,
): RegressionEntry[] {
  const regressions: RegressionEntry[] = [];

  // Build a map of previous assertion results by eval_id + assertion_id
  const prevMap = new Map<string, boolean>();
  for (const c of previous.cases) {
    for (const a of c.assertions) {
      prevMap.set(`${c.eval_id}:${a.id}`, a.pass);
    }
  }

  for (const c of current.cases) {
    for (const a of c.assertions) {
      const key = `${c.eval_id}:${a.id}`;
      const prev = prevMap.get(key);
      if (prev === undefined) continue; // New assertion, skip

      if (prev && !a.pass) {
        regressions.push({
          assertionId: a.id,
          evalId: c.eval_id,
          evalName: c.eval_name,
          previousStatus: true,
          currentStatus: false,
          change: "regression",
        });
      } else if (!prev && a.pass) {
        regressions.push({
          assertionId: a.id,
          evalId: c.eval_id,
          evalName: c.eval_name,
          previousStatus: false,
          currentStatus: true,
          change: "improvement",
        });
      }
    }
  }

  return regressions;
}
