import type { EvalsFile, BenchmarkResult, StatsResult, ActivationResult, ActivationSummary, EvalChange } from "../../types";
import type { ProgressEntry } from "../../components/ProgressLog";
import type { ClassifiedError } from "../../components/ErrorCard";

// ---------------------------------------------------------------------------
// Panel IDs
// ---------------------------------------------------------------------------

export type PanelId = "editor" | "tests" | "run" | "activation" | "history" | "deps" | "leaderboard" | "versions";

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
  classifiedError?: ClassifiedError;
  durationMs?: number;
  tokens?: number | null;
  output?: string;
  assertions: AssertionResultInline[];
}

// ---------------------------------------------------------------------------
// Run modes
// ---------------------------------------------------------------------------

export type RunMode = "benchmark" | "baseline" | "comparison";

// ---------------------------------------------------------------------------
// Per-case run state
// ---------------------------------------------------------------------------

export type CaseRunStatus = "idle" | "queued" | "running" | "complete" | "error" | "cancelled";

export interface CaseRunState {
  status: CaseRunStatus;
  startedAt?: number;
  mode?: RunMode;
}

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
  evalsError: string | null; // set when evals.json exists but fails validation

  // Panel
  activePanel: PanelId;
  selectedCaseId: number | null;

  // Per-case run state
  caseRunStates: Map<number, CaseRunState>;
  bulkRunActive: boolean;
  runMode: RunMode | null;
  latestBenchmark: BenchmarkResult | null;
  inlineResults: Map<number, InlineResult>;

  // Improve state
  improveTarget: number | null; // eval_id to improve for

  // AI Edit state (freeform instruction-based editing)
  aiEditOpen: boolean;
  aiEditLoading: boolean;
  aiEditResult: { improved: string; reasoning: string; evalChanges: EvalChange[] } | null;
  aiEditError: string | null;
  aiEditClassifiedError: ClassifiedError | null;
  aiEditProgress: ProgressEntry[];
  aiEditEvalChanges: EvalChange[];
  aiEditEvalSelections: Map<number, boolean>;
  aiEditEvalsRetry: EvalsFile | null;

  // Generate evals state
  generateEvalsLoading: boolean;
  generateEvalsProgress: ProgressEntry[];
  generateEvalsError: ClassifiedError | null;

  // History
  regressions: RegressionInfo[];

  // Iteration tracking
  iterationCount: number;

  // Activation test state
  activationPrompts: string;
  activationResults: ActivationResult[];
  activationSummary: (ActivationSummary & { description?: string }) | null;
  activationRunning: boolean;
  activationError: string | null;
  activationTotalPrompts: number;
  activationStartedAt: number | null;
  activationClassifyingStatus: string | null;
  // Increment 0776: where the current prompts text came from. Drives the
  // "from SKILL.md" / "AI-generated" badge in ActivationPanel.
  activationPromptsSource: "skill-md" | "ai-generated" | "user-typed" | null;
  // The canonical prompts text last loaded from a source. When `activationPrompts`
  // diverges from this, we flip the source to "user-typed".
  activationPromptsCanonical: string;

  // AI prompt generation
  generatingPrompts: boolean;
  generatingPromptsError: string | null;

  // Test-cases save (increment 0776)
  savingTestCases: boolean;
  savingTestCasesError: string | null;
  savingTestCasesSuccess: string | null;

  // Activation history
  activationHistory: ActivationHistoryRun[] | null;
  activationHistoryLoading: boolean;

  // Loading
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Activation history types
// ---------------------------------------------------------------------------

export interface ActivationHistoryRun {
  id: string;
  timestamp: string;
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
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "INIT_DATA"; skillContent: string; evals: EvalsFile | null; evalsError?: string | null; benchmark: BenchmarkResult | null }
  | { type: "SET_PANEL"; panel: PanelId }
  | { type: "SET_CONTENT"; content: string }
  | { type: "CONTENT_SAVED" }
  | { type: "SET_EVALS"; evals: EvalsFile }
  | { type: "SELECT_CASE"; caseId: number | null }
  | { type: "CASE_RUN_START"; caseId: number; mode: RunMode }
  | { type: "CASE_RUN_COMPLETE"; caseId: number; result: InlineResult }
  | { type: "CASE_RUN_ERROR"; caseId: number; error: string }
  | { type: "CASE_RUN_CANCEL"; caseId: number }
  | { type: "BULK_RUN_START"; caseIds: number[]; mode: RunMode }
  | { type: "BULK_RUN_COMPLETE"; benchmark: BenchmarkResult | null }
  | { type: "CANCEL_ALL" }
  | { type: "UPDATE_INLINE_RESULT"; evalId: number; result: InlineResult }
  | { type: "OPEN_IMPROVE"; evalId: number }
  | { type: "CLOSE_IMPROVE" }
  | { type: "OPEN_AI_EDIT" }
  | { type: "CLOSE_AI_EDIT" }
  | { type: "AI_EDIT_LOADING" }
  | { type: "AI_EDIT_PROGRESS"; entry: ProgressEntry }
  | { type: "AI_EDIT_RESULT"; improved: string; reasoning: string; evalChanges: EvalChange[] }
  | { type: "AI_EDIT_ERROR"; message: string; classified?: ClassifiedError }
  | { type: "GENERATE_EVALS_START" }
  | { type: "GENERATE_EVALS_PROGRESS"; entry: ProgressEntry }
  | { type: "GENERATE_EVALS_DONE"; evals: EvalsFile }
  | { type: "GENERATE_EVALS_ERROR"; classified: ClassifiedError }
  | { type: "TOGGLE_EVAL_CHANGE"; index: number }
  | { type: "SELECT_ALL_EVAL_CHANGES" }
  | { type: "DESELECT_ALL_EVAL_CHANGES" }
  | { type: "SET_EVALS_RETRY"; evalsFile: EvalsFile }
  | { type: "SET_REGRESSIONS"; regressions: RegressionInfo[] }
  | { type: "INCREMENT_ITERATION" }
  | { type: "SET_ACTIVATION_PROMPTS"; prompts: string }
  | { type: "ACTIVATION_START" }
  | { type: "ACTIVATION_RESULT"; result: ActivationResult }
  | { type: "ACTIVATION_DONE"; summary: ActivationSummary & { description?: string } }
  | { type: "ACTIVATION_ERROR"; error: string }
  | { type: "ACTIVATION_CLASSIFYING"; index: number; total: number }
  | { type: "ACTIVATION_RESET" }
  | { type: "ACTIVATION_TIMEOUT" }
  | { type: "ACTIVATION_CANCEL"; totalPrompts: number }
  | { type: "GENERATE_PROMPTS_START" }
  | { type: "GENERATE_PROMPTS_DONE" }
  | { type: "SET_PROMPTS_SOURCE"; source: "skill-md" | "ai-generated" | "user-typed" | null; canonical?: string }
  | { type: "SAVE_TEST_CASES_START" }
  | { type: "SAVE_TEST_CASES_SUCCESS"; count: number }
  | { type: "SAVE_TEST_CASES_ERROR"; error: string }
  | { type: "CLEAR_SAVE_TEST_CASES_FEEDBACK" }
  | { type: "GENERATE_PROMPTS_ERROR"; error: string }
  | { type: "ACTIVATION_HISTORY_LOADED"; runs: ActivationHistoryRun[] };

// ---------------------------------------------------------------------------
// Context value
// ---------------------------------------------------------------------------

export interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
  isReadOnly: boolean;

  // Async actions
  saveContent: () => Promise<void>;
  saveEvals: (updated: EvalsFile) => Promise<void>;
  runCase: (caseId: number, mode?: RunMode) => void;
  runAll: (mode?: RunMode) => void;
  cancelCase: (caseId: number) => void;
  cancelAll: () => void;
  improveForCase: (evalId: number, notes?: string) => Promise<void>;
  applyImproveAndRerun: (evalId: number, improved: string) => Promise<void>;
  refreshSkillContent: () => Promise<void>;
  generateEvals: (opts?: { testType?: "unit" | "integration" }) => Promise<void>;
  runActivationTest: (prompts: string) => void;
  cancelActivation: () => void;
  generateActivationPrompts: (count?: number) => void;
  fetchActivationHistory: () => void;
  // Increment 0776: load committed `## Test Cases` from SKILL.md, save current
  // textarea prompts back as a `## Test Cases` block.
  loadTestCasesFromSkillMd: () => Promise<void>;
  saveTestCasesToSkillMd: () => Promise<void>;
  submitAiEdit: (instruction: string, provider?: string, model?: string) => void;
  cancelAiEdit: () => void;
  applyAiEdit: () => Promise<void>;
  discardAiEdit: () => void;
  toggleEvalChange: (index: number) => void;
  selectAllEvalChanges: () => void;
  deselectAllEvalChanges: () => void;
  retryEvalsSave: () => Promise<void>;
}
