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
  testType?: "unit" | "integration";
  requiredCredentials?: string[];
  requirements?: {
    chromeProfile?: string;
    platform?: string;
  };
  cleanup?: Array<{
    action: "delete_post" | "remove_artifact" | "custom";
    platform?: string;
    identifier?: string;
    description?: string;
  }>;
}

export function getTestType(evalCase: EvalCase): "unit" | "integration" {
  return evalCase.testType === "integration" ? "integration" : "unit";
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
  /**
   * Origin classification — SSoT is classifyOrigin() in src/eval/skill-scanner.ts.
   * Guaranteed non-null by the /api/skills response normalizer in api.ts (T-021).
   * Drives the sidebar OWN/INSTALLED split.
   */
  origin: "source" | "installed";
  // -------------------------------------------------------------------------
  // T-025: Frontmatter + filesystem fields — backward-compatible extension.
  //
  // All new fields use `| null` (JSON-serializable) rather than `?`/undefined
  // so that existing consumers see a consistent shape. The server populates
  // these from SKILL.md frontmatter parsing + fs.statSync. When a field is
  // absent or unreadable, the server MUST return null.
  // -------------------------------------------------------------------------
  /** Frontmatter `description` — primary triggering text for the skill. */
  description?: string | null;
  /** Frontmatter `version` — semver string, if declared. Separate from installed `currentVersion` below. */
  version?: string | null;
  /** Frontmatter `category` — e.g. "productivity", "devops". */
  category?: string | null;
  /** Frontmatter `author`. */
  author?: string | null;
  /** Frontmatter `license` — SPDX identifier when provided. */
  license?: string | null;
  /** Frontmatter `homepage` URL. */
  homepage?: string | null;
  /** Frontmatter `tags` — freeform taxonomy. */
  tags?: string[] | null;
  /** Frontmatter `deps` or `skill-deps` — other skills this one depends on. */
  deps?: string[] | null;
  /** Frontmatter `mcp-deps` or `mcpDeps` — MCP server names this skill expects. */
  mcpDeps?: string[] | null;
  /** Entry-point file relative to dir (default `"SKILL.md"`). */
  entryPoint?: string | null;
  /** ISO 8601 timestamp of the most recent mtime in the skill dir. */
  lastModified?: string | null;
  /** Total byte size of the skill dir (sum of regular files, non-recursive fine for now). */
  sizeBytes?: number | null;
  /** For `origin: "installed"` only — the agent id whose config owns this skill (e.g. "claude-code"). */
  sourceAgent?: string | null;
  // -------------------------------------------------------------------------
  // Pre-existing install/update state (populated by mergeUpdatesIntoSkills).
  // -------------------------------------------------------------------------
  updateAvailable?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  pinnedVersion?: string;
}

// ---------------------------------------------------------------------------
// Version lifecycle types (Phase 2)
// ---------------------------------------------------------------------------

export interface VersionEntry {
  version: string;
  certTier: string;
  certScore?: number;
  diffSummary: string | null;
  createdAt: string;
  isInstalled?: boolean;
}

export interface VersionDiff {
  from: string;
  to: string;
  diffSummary: string;
  contentDiff: string;
}

export interface VersionDetail {
  version: string;
  content: string;
  certTier: string;
  certScore?: number;
  createdAt: string;
}

export interface BatchUpdateProgress {
  skill: string;
  status: "pending" | "updating" | "scanning" | "installing" | "done" | "error" | "skipped";
  fromVersion?: string;
  toVersion?: string;
  scanScore?: number;
  scanVerdict?: string;
  error?: string;
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
  cost?: number | null;
  billingMode?: string;
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
  totalCost?: number | null;
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
  totalCost?: number | null;
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
  runA: { timestamp: string; model: string; passRate: number; type: string; totalCost?: number | null };
  runB: { timestamp: string; model: string; passRate: number; type: string; totalCost?: number | null };
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
  baselinePassRate?: number;
}

export interface StatsResult {
  totalRuns: number;
  totalCost?: number | null;
  costPerRun?: number | null;
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
    avgCost?: number | null;
  }>;
  trendPoints: Array<{
    timestamp: string;
    passRate: number;
    model: string;
    cost?: number | null;
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

export interface AiGenerationMeta {
  prompt: string;
  provider: string;
  model: string;
  reasoning: string;
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
  aiMeta?: AiGenerationMeta;
  draftDir?: string;
}

export interface CreateSkillResponse {
  ok: boolean;
  plugin: string;
  skill: string;
  dir: string;
  skillMdPath: string;
}

export interface SaveDraftRequest extends CreateSkillRequest {
  aiMeta: AiGenerationMeta;
}

export interface SaveDraftResponse {
  ok: boolean;
  plugin: string;
  skill: string;
  dir: string;
  skillMdPath: string;
  files: string[];
}

export interface SkillFileEntry {
  path: string;
  size: number;
  type: "file" | "dir";
}

export interface SkillFileContent {
  path: string;
  content?: string;
  size: number;
  binary?: boolean;
  truncated?: boolean;
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

// ---------------------------------------------------------------------------
// Sweep / Leaderboard types (T-054)
// ---------------------------------------------------------------------------

export interface ModelStats {
  mean: number;
  stddev: number;
  median?: number;
  ci95?: [number, number];
}

export interface ModelResult {
  provider: string;
  model: string;
  passRate: ModelStats;
  rubricScore?: ModelStats;
  duration: ModelStats;
  cost: { total: number; perCase: number } | null;
  status: "complete" | "error";
  errorMessage: string | null;
  caseResults?: Array<{
    eval_id: number;
    eval_name: string;
    status: "pass" | "fail" | "error";
    pass_rate: number;
  }>;
  // Baseline comparison (populated when --baseline is used)
  baselinePassRate?: ModelStats;
  skillDelta?: ModelStats;
  amplificationPct?: number;
  compositeScore?: number;
}

export interface SweepResult {
  sweepId: string;
  timestamp: string;
  judge: string;
  runs: number;
  models: ModelResult[];
  baselineEnabled?: boolean;
  skillQualityScore?: number;
  skillQualityRating?: "excellent" | "good" | "marginal" | "minimal" | "harmful";
  judgeBiasWarning?: string;
}

export interface LeaderboardEntry {
  rank: number;
  model: string;
  provider: string;
  passRate: number;
  rubricScore: number | null;
  duration: number;
  cost: number | null;
  sparklineData: number[];
  isBest: boolean;
  // Baseline fields (populated when sweep used --baseline)
  baselinePassRate?: number;
  skillDelta?: number;
  amplificationPct?: number;
  compositeScore?: number;
  hasBaseline: boolean;
}

export interface CredentialStatus {
  name: string;
  status: "ready" | "missing" | "resolved" | "untested" | "error";
  source?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: number; completion: number };
}

