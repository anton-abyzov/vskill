// ---------------------------------------------------------------------------
// progress-log.ts -- Write eval progress to a JSON file for external monitoring
//
// During long-running eval operations (2-10 minutes), this file allows
// users to check progress from another terminal:
//   cat skills/my-skill/evals/.eval-progress.json
//
// The file is created at start and deleted on completion.
// ---------------------------------------------------------------------------

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface ProgressState {
  startedAt: string;
  provider: string;
  model: string;
  totalCases: number;
  completedCases: number;
  currentCase: string | null;
  phase: "starting" | "generating" | "judging" | "complete" | "error";
  elapsedMs: number;
  estimatedTotalSec: number | null;
  lastError: string | null;
}

const PROGRESS_FILE = ".eval-progress.json";

export class ProgressLog {
  private filePath: string;
  private startTime: number;
  private state: ProgressState;

  constructor(skillDir: string, provider: string, model: string, totalCases: number, estimatedTotalSec: number | null) {
    this.filePath = join(skillDir, "evals", PROGRESS_FILE);
    this.startTime = Date.now();
    this.state = {
      startedAt: new Date().toISOString(),
      provider,
      model,
      totalCases,
      completedCases: 0,
      currentCase: null,
      phase: "starting",
      elapsedMs: 0,
      estimatedTotalSec,
      lastError: null,
    };
    this.write();
  }

  update(partial: Partial<ProgressState>): void {
    Object.assign(this.state, partial, { elapsedMs: Date.now() - this.startTime });
    this.write();
  }

  complete(): void {
    this.state.phase = "complete";
    this.state.elapsedMs = Date.now() - this.startTime;
    this.cleanup();
  }

  error(msg: string): void {
    this.state.phase = "error";
    this.state.lastError = msg;
    this.state.elapsedMs = Date.now() - this.startTime;
    this.write();
  }

  private write(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch {
      // Non-critical — don't crash eval for progress logging
    }
  }

  private cleanup(): void {
    try {
      unlinkSync(this.filePath);
    } catch {
      // File may not exist
    }
  }
}
