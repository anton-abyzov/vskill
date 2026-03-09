import type { EvalsFile, BenchmarkResult, StatsResult } from "../../types";

// ---------------------------------------------------------------------------
// Panel IDs
// ---------------------------------------------------------------------------

export type PanelId = "editor" | "tests" | "run" | "history" | "deps";

// ---------------------------------------------------------------------------
// Inline result (per-case benchmark result for cross-panel display)
// ---------------------------------------------------------------------------

export interface AssertionResultInline {
  assertion_id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

export interface InlineResult {
  status?: string;
  passRate?: number;
  errorMessage?: string;
  durationMs?: number;
  tokens?: number | null;
  output?: string;
  assertions: AssertionResultInline[];
}

// ---------------------------------------------------------------------------
// Run modes
// ---------------------------------------------------------------------------

export type RunMode = "benchmark" | "baseline" | "comparison";
export type RunScope = "all" | { caseId: number };

// ---------------------------------------------------------------------------
// Regression info
// ---------------------------------------------------------------------------

export interface RegressionInfo {
  assertionId: string;
  evalId: number;
  evalName: string;
  change: "regression" | "improvement";
}

// ---------------------------------------------------------------------------
// Workspace state
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  // Identity
  plugin: string;
  skill: string;

  // Skill content
  skillContent: string;
  savedContent: string;
  isDirty: boolean;

  // Evals
  evals: EvalsFile | null;

  // Panel
  activePanel: PanelId;
  selectedCaseId: number | null;

  // Run state
  isRunning: boolean;
  runMode: RunMode | null;
  runScope: RunScope | null;
  latestBenchmark: BenchmarkResult | null;
  inlineResults: Map<number, InlineResult>;

  // Improve state
  improveTarget: number | null; // eval_id to improve for

  // History
  regressions: RegressionInfo[];

  // Iteration tracking
  iterationCount: number;

  // Loading
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "INIT_DATA"; skillContent: string; evals: EvalsFile | null; benchmark: BenchmarkResult | null }
  | { type: "SET_PANEL"; panel: PanelId }
  | { type: "SET_CONTENT"; content: string }
  | { type: "CONTENT_SAVED" }
  | { type: "SET_EVALS"; evals: EvalsFile }
  | { type: "SELECT_CASE"; caseId: number | null }
  | { type: "RUN_START"; mode: RunMode; scope: RunScope }
  | { type: "RUN_COMPLETE"; benchmark: BenchmarkResult }
  | { type: "UPDATE_INLINE_RESULT"; evalId: number; result: InlineResult }
  | { type: "OPEN_IMPROVE"; evalId: number }
  | { type: "CLOSE_IMPROVE" }
  | { type: "SET_REGRESSIONS"; regressions: RegressionInfo[] }
  | { type: "INCREMENT_ITERATION" };

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;

  // Async actions
  saveContent: () => Promise<void>;
  saveEvals: (updated: EvalsFile) => Promise<void>;
  runBenchmark: (mode: RunMode, scope: RunScope) => void;
  improveForCase: (evalId: number, notes?: string) => Promise<void>;
  applyImproveAndRerun: (evalId: number, improved: string) => Promise<void>;
  refreshSkillContent: () => Promise<void>;
  generateEvals: () => Promise<void>;
}
