// ---------------------------------------------------------------------------
// activation-history.ts -- persistent activation test history per skill
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ActivationResult } from "./activation-tester.js";

export interface ActivationHistoryRun {
  id: string;           // "run-{timestamp}"
  timestamp: string;    // ISO 8601
  model: string;
  provider: string;
  promptCount: number;
  summary: {
    precision: number;
    recall: number;
    reliability: number;
    tp: number;
    tn: number;
    fp: number;
    fn: number;
  };
  results: ActivationResult[];
}

interface ActivationHistoryFile {
  runs: ActivationHistoryRun[];
}

const HISTORY_FILENAME = "activation-history.json";
const MAX_RUNS = 50;

function historyPath(skillDir: string): string {
  return join(skillDir, HISTORY_FILENAME);
}

async function readHistoryFile(skillDir: string): Promise<ActivationHistoryFile> {
  try {
    const content = await readFile(historyPath(skillDir), "utf-8");
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.runs)) return parsed as ActivationHistoryFile;
    return { runs: [] };
  } catch {
    return { runs: [] };
  }
}

export async function writeActivationRun(
  skillDir: string,
  run: ActivationHistoryRun,
): Promise<void> {
  await mkdir(skillDir, { recursive: true });
  const history = await readHistoryFile(skillDir);
  history.runs.push(run);
  // Prune oldest if over cap
  if (history.runs.length > MAX_RUNS) {
    history.runs = history.runs.slice(history.runs.length - MAX_RUNS);
  }
  await writeFile(historyPath(skillDir), JSON.stringify(history, null, 2));
}

export async function listActivationRuns(
  skillDir: string,
): Promise<Omit<ActivationHistoryRun, "results">[]> {
  const history = await readHistoryFile(skillDir);
  return history.runs.map(({ results: _results, ...rest }) => rest).reverse();
}

export async function getActivationRun(
  skillDir: string,
  runId: string,
): Promise<ActivationHistoryRun | null> {
  const history = await readHistoryFile(skillDir);
  return history.runs.find((r) => r.id === runId) ?? null;
}
