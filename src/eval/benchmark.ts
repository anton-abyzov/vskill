// ---------------------------------------------------------------------------
// benchmark.json read/write
// ---------------------------------------------------------------------------

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface BenchmarkAssertionResult {
  id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

export interface BenchmarkCase {
  eval_id: number;
  eval_name: string;
  status: "pass" | "fail" | "error";
  error_message: string | null;
  pass_rate: number;
  assertions: BenchmarkAssertionResult[];
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  skill_name: string;
  cases: BenchmarkCase[];
  overall_pass_rate?: number;
}

export async function writeBenchmark(
  skillDir: string,
  result: BenchmarkResult,
): Promise<void> {
  const evalsDir = join(skillDir, "evals");
  mkdirSync(evalsDir, { recursive: true });
  const filePath = join(evalsDir, "benchmark.json");
  writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
}

export async function readBenchmark(
  skillDir: string,
): Promise<BenchmarkResult | null> {
  const filePath = join(skillDir, "evals", "benchmark.json");
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as BenchmarkResult;
  } catch {
    return null;
  }
}
