// Types mirroring backend API shapes (no backend imports to avoid tsconfig clash)

export interface Assertion {
  id: string;
  text: string;
  type: "boolean";
}

export interface EvalCase {
  id: number;
  name: string;
  prompt: string;
  expected_output: string;
  files: string[];
  assertions: Assertion[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
}

export interface SkillInfo {
  plugin: string;
  skill: string;
  dir: string;
  hasEvals: boolean;
  hasBenchmark: boolean;
  evalCount: number;
  assertionCount: number;
  benchmarkStatus: "pass" | "fail" | "pending" | "stale" | "missing";
  lastBenchmark: string | null;
  origin: "source" | "installed";
}

export interface BenchmarkAssertionResult {
  id: string;
  text: string;
  pass: boolean;
  reasoning: string;
}

export interface ComparisonCaseDetail {
  skillDurationMs: number;
  skillTokens: number | null;
  skillInputTokens?: number | null;
  skillOutputTokens?: number | null;
  baselineDurationMs: number;
  baselineTokens: number | null;
  baselineInputTokens?: number | null;
  baselineOutputTokens?: number | null;
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
  winner: "skill" | "baseline" | "tie";
}

export interface BenchmarkCase {
  eval_id: number;
  eval_name: string;
  status: "pass" | "fail" | "error";
  error_message: string | null;
  pass_rate: number;
  durationMs?: number;
  tokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  output?: string;
  assertions: BenchmarkAssertionResult[];
  comparisonDetail?: ComparisonCaseDetail;
}

export type ActionRecommendation = "keep" | "improve" | "rewrite" | "remove";

export interface ActionItems {
  recommendation: ActionRecommendation;
  summary: string;
  weaknesses: string[];
  strengths: string[];
  suggestedFocus: string;
}

export interface BenchmarkResult {
  timestamp: string;
  model: string;
  skill_name: string;
  cases: BenchmarkCase[];
  overall_pass_rate?: number;
  type?: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  provider?: string;
  totalDurationMs?: number;
  totalInputTokens?: number | null;
  totalOutputTokens?: number | null;
  verdict?: string;
  comparison?: {
    skillPassRate: number;
    baselinePassRate: number;
    skillRubricAvg: number;
    baselineRubricAvg: number;
    delta: number;
  };
  improve?: {
    original: string;
    improved: string;
    reasoning: string;
  };
  generate?: {
    prompt: string;
    result: string;
  };
  actionItems?: ActionItems;
}

export interface HistorySummary {
  timestamp: string;
  filename: string;
  model: string;
  skillName: string;
  passRate: number;
  type: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  caseCount?: number;
  totalDurationMs?: number;
  totalTokens?: number | null;
  provider?: string;
  verdict?: string;
}

export interface HistoryFilter {
  model?: string;
  type?: "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate";
  from?: string;
  to?: string;
}

export interface HistoryCompareResult {
  runA: { timestamp: string; model: string; passRate: number; type: string };
  runB: { timestamp: string; model: string; passRate: number; type: string };
  regressions: Array<{
    assertionId: string;
    evalId: number;
    evalName: string;
    change: "regression" | "improvement";
  }>;
  caseDiffs: Array<{
    eval_id: number;
    eval_name: string;
    statusA: "pass" | "fail" | "error" | "missing";
    statusB: "pass" | "fail" | "error" | "missing";
    passRateA: number | null;
    passRateB: number | null;
    durationMsA?: number | null;
    durationMsB?: number | null;
    tokensA?: number | null;
    tokensB?: number | null;
  }>;
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
}

export interface StatsResult {
  totalRuns: number;
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
  }>;
  trendPoints: Array<{
    timestamp: string;
    passRate: number;
    model: string;
  }>;
}

export interface ActivationResult {
  prompt: string;
  expected: "should_activate" | "should_not_activate";
  activate: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
  classification: "TP" | "TN" | "FP" | "FN";
  autoClassified?: boolean;
}

export interface ActivationSummary {
  results: ActivationResult[];
  precision: number;
  recall: number;
  reliability: number;
  total: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  autoClassifiedCount?: number;
}

export interface ImproveResult {
  original: string;
  improved: string;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Smart AI Edit: eval change suggestions
// ---------------------------------------------------------------------------

export interface EvalChange {
  action: "add" | "modify" | "remove";
  reason: string;
  evalId?: number;
  eval?: EvalCase;
}

export interface SmartEditResult extends ImproveResult {
  evalChanges: EvalChange[];
}

export interface McpDependency {
  server: string;
  url: string;
  transport: "http" | "stdio";
  matchedTools: string[];
  configSnippet: string;
}

export interface SkillDependencyInfo {
  name: string;
  source: "body-reference" | "frontmatter";
}

export interface DependenciesResponse {
  mcpDependencies: McpDependency[];
  skillDependencies: SkillDependencyInfo[];
}

// ---------------------------------------------------------------------------
// Skill creation types
// ---------------------------------------------------------------------------

export interface DetectedLayout {
  layout: 1 | 2 | 3 | 4;
  label: string;
  pathTemplate: string;
  existingPlugins: string[];
}

export interface ProjectLayoutResponse {
  root: string;
  detectedLayouts: DetectedLayout[];
  suggestedLayout: 1 | 2 | 3;
  existingSkills: Array<{ plugin: string; skill: string }>;
}

export interface EvalAssertion {
  id: string;
  text: string;
  type: string;
}

export interface GeneratedEval {
  id: number;
  name: string;
  prompt: string;
  expected_output: string;
  assertions: EvalAssertion[];
}

export interface CreateSkillRequest {
  name: string;
  plugin: string;
  layout: 1 | 2 | 3;
  description: string;
  model?: string;
  allowedTools?: string;
  body: string;
  evals?: GeneratedEval[];
}

export interface CreateSkillResponse {
  ok: boolean;
  plugin: string;
  skill: string;
  dir: string;
  skillMdPath: string;
}

export interface SkillCreatorStatus {
  installed: boolean;
  installCommand: string;
}

export interface GenerateSkillResponse {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
  evals: GeneratedEval[];
  reasoning: string;
}

