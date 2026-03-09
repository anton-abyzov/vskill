// ---------------------------------------------------------------------------
// benchmark-history.ts -- timestamped benchmark history with regression diffing
// ---------------------------------------------------------------------------

import { readdir, readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BenchmarkResult, BenchmarkAssertionResult } from "./benchmark.js";
import { writeBenchmark } from "./benchmark.js";

export interface HistorySummary {
  timestamp: string;
  filename: string;
  model: string;
  skillName: string;
  passRate: number;
  type: "benchmark" | "comparison" | "baseline";
  caseCount: number;
  totalDurationMs: number;
  totalTokens: number | null;
  provider?: string;
  verdict?: string;
}

export interface HistoryFilter {
  model?: string;
  type?: "benchmark" | "comparison" | "baseline";
  from?: string; // ISO timestamp
  to?: string;   // ISO timestamp
}

export interface CaseHistoryEntry {
  timestamp: string;
  model: string;
  type: "benchmark" | "comparison" | "baseline";
  provider?: string;
  pass_rate: number;
  durationMs?: number;
  tokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  assertions: BenchmarkAssertionResult[];
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
  result: BenchmarkResult & { type?: "benchmark" | "comparison" | "baseline" },
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
      });
    } catch {
      // Skip malformed files
    }
  }
  return entries;
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
