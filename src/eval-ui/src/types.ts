// Types mirroring backend API shapes (no backend imports to avoid tsconfig clash)

// ---------------------------------------------------------------------------
// 0688: Studio scope-transfer — mirrored from src/studio/types.ts.
// Keep these shapes in sync manually (existing client/server pattern).
// ---------------------------------------------------------------------------

/**
 * 0688 legacy tri-scope vocabulary. Used by StudioOp + scope-transfer routes.
 * 0698 introduces a new five-value `SkillScope` (below) aligned with Anthropic
 * docs; 0688 internals continue to operate on this legacy union and translate
 * at the api.ts boundary via `normalizeSkillScope`.
 */
export type LegacyTriScope = "own" | "installed" | "global";

/**
 * 0698 T-001: scope union aligned with Anthropic docs vocabulary
 * (https://code.claude.com/docs/en/skills, /plugins).
 *
 * Two orthogonal axes encoded in the string:
 *   group:  "available" | "authoring"
 *   source: "project"   | "personal"  | "plugin"
 *
 * Five valid combinations (personal + authoring is invalid — never emitted).
 */
export type SkillScope =
  | "available-project"
  | "available-personal"
  | "available-plugin"
  | "authoring-project"
  | "authoring-plugin";

/** 0698 T-001: derived from SkillScope — top-level sidebar group. */
export type SkillGroup = "available" | "authoring";

/** 0698 T-001: derived from SkillScope — sub-section / source badge. */
export type SkillSource = "project" | "personal" | "plugin";

export type StudioOpName =
  | "promote"
  | "revert"
  | "test-install"
  | "skill-create"
  | "skill-edit"
  | "skill-delete"
  | "model-config-change";

export interface StudioOp {
  id: string;
  ts: number;
  op: StudioOpName;
  skillId?: string;
  fromScope?: LegacyTriScope;
  toScope?: LegacyTriScope;
  paths?: { source: string; dest: string };
  actor: "studio-ui";
  details?: Record<string, unknown>;
}

export interface Provenance {
  promotedFrom: "installed" | "global";
  sourcePath: string;
  promotedAt: number;
  sourceSkillVersion?: string;
}

export type TransferEvent =
  | {
      type: "started";
      opId: string;
      skillId: string;
      fromScope: string;
      toScope: string;
      sourcePath: string;
      destPath: string;
    }
  | { type: "copied"; filesWritten: number }
  | { type: "deleted"; filesDeleted: number }
  | { type: "indexed" }
  | { type: "done"; opId: string; destPath: string }
  | { type: "error"; code: string; message: string };

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
  /**
   * Increment 0750: resolved version for sidebar/UI display, computed by the
   * normalizer (`normalizeSkillInfo`) via the precedence chain
   * `frontmatter > registry currentVersion > plugin.json version > "0.0.0"`.
   * Always non-empty when the skill came through the normalizer; consumers
   * MAY fall back to `version` for raw fixtures bypassing the normalizer.
   */
  resolvedVersion?: string;
  /**
   * Increment 0750: provenance label for `resolvedVersion`. Drives the
   * source-aware styling in `VersionBadge` (normal weight for `frontmatter`,
   * italic + tooltip for `registry` | `plugin` | `default`).
   */
  versionSource?: "frontmatter" | "registry" | "plugin" | "default";
  /** Frontmatter `category` — e.g. "productivity", "devops". */
  category?: string | null;
  /** Frontmatter `author`. */
  author?: string | null;
  /** Frontmatter `license` — SPDX identifier when provided. */
  license?: string | null;
  /** Frontmatter `homepage` URL. */
  homepage?: string | null;
  /**
   * 0737: Canonical https:// URL of the source GitHub repo, derived from
   * vskill.lock. Drives the source-file anchor on the Studio detail header.
   * `null` for authored skills with no install record.
   */
  repoUrl?: string | null;
  /**
   * 0737: Relative path inside the repo to the SKILL.md (e.g.
   * "skills/foo/SKILL.md"). Defaults to "SKILL.md" for flat-layout
   * installs. `null` when no source repo is known.
   */
  skillPath?: string | null;
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
  /** For `origin: "installed"` / tri-scope `installed` + `global` — the agent id whose config owns this skill (e.g. "claude-code"). null for `own` scope. */
  sourceAgent?: string | null;
  /**
   * 0688: Provenance sidecar — present when this OWN skill was created via
   * "Promote to OWN" (copied from an INSTALLED/GLOBAL skill) and a
   * `.vskill-meta.json` sidecar exists in the skill dir. `null` for skills
   * authored from scratch. Populated by the scanner.
   */
  provenance?: Provenance | null;
  // -------------------------------------------------------------------------
  // 0686: tri-scope sidebar + symlink transparency.
  //
  // The server (scanSkillsTriScope + /api/skills enrichment) populates these
  // on every response. UI partitions the sidebar into OWN / INSTALLED / GLOBAL
  // using `scope`, renders a chain-link glyph when `isSymlink === true`, and
  // prints a human "Install method" row from `installMethod`.
  //
  // Back-compat: when the server returns a legacy shape (no `scope`), the
  // normalizer in api.ts defaults `scope` to `"own"` (AC-US3-02).
  // -------------------------------------------------------------------------
  /** OWN (user-authored, outside any wrapper) / INSTALLED (agent's project-local) / GLOBAL (agent's home). */
  scope?: "own" | "installed" | "global";
  /**
   * 0698 T-001: new scope union aligned with Anthropic docs vocabulary.
   * Coexists with legacy `scope` during 0688 overlap. T-007 ripples consumers
   * to read `scopeV2` (and eventually swap names). Set by `normalizeSkillInfo`.
   */
  scopeV2?: SkillScope;
  /** 0698 T-001: derived from scopeV2 — split for sidebar grouping. */
  group?: SkillGroup;
  /** 0698 T-001: derived from scopeV2 — split for source badge / sub-section. */
  source?: SkillSource;
  /** 0698 T-001: plugin metadata (set when source === "plugin"). */
  pluginName?: string | null;
  /** 0698 T-001: namespaced display label e.g. "anthropic-skills:pdf". */
  pluginNamespace?: string | null;
  /** 0698 T-001: marketplace folder name (AVAILABLE > Plugins only). */
  pluginMarketplace?: string | null;
  /** 0698 T-001: absolute path to plugin.json (AUTHORING > Plugins only). */
  pluginManifestPath?: string | null;
  /** 0698 T-001: plugin version dir (AVAILABLE > Plugins, when present). */
  pluginVersion?: string | null;
  /**
   * 0698 T-001/T-002: precedence within AVAILABLE for shadow detection.
   * personal=1, project=2 (lower wins). plugin=-1 (orthogonal — never shadowed).
   * Computed by the scanner precedence pass.
   */
  precedenceRank?: number;
  /** 0698 T-001/T-002: when this skill is shadowed by a higher-precedence one in AVAILABLE, which scope wins. `null` for the winner; `undefined` for AUTHORING/plugin. */
  shadowedBy?: SkillScope | null;
  /** `fs.lstatSync(dir).isSymbolicLink()` at scan time. */
  isSymlink?: boolean;
  /** Absolute realpath of the symlink target. `null` when not a symlink, or when a cycle was detected. */
  symlinkTarget?: string | null;
  /** How the skill got here: author (own), copied (regular file install), or symlinked (plugin cache). */
  installMethod?: "authored" | "copied" | "symlinked";
  /**
   * 0769 T-009: editable upstream source path for plugin-cache installs
   * (~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<skill>).
   * `null` when no marketplace clone exists. The DetailHeader path chip
   * prefers this over `dir` (the per-version cache snapshot).
   */
  sourcePath?: string | null;
  // -------------------------------------------------------------------------
  // Pre-existing install/update state (populated by mergeUpdatesIntoSkills).
  // -------------------------------------------------------------------------
  updateAvailable?: boolean;
  currentVersion?: string;
  latestVersion?: string;
  pinnedVersion?: string;
  /**
   * 0708 AC-US6-03: true when the platform has a `sourceRepoUrl` recorded
   * for this skill (live SSE updates flow); false when the upstream is
   * unknown and the user must run `vskill outdated` manually. Omitted for
   * payloads that predate 0708 — callers should treat `undefined` as
   * "assume tracked" to avoid spamming the not-tracked dot.
   */
  trackedForUpdates?: boolean;
}

// ---------------------------------------------------------------------------
// 0686: /api/agents response shape (consumed by AgentScopePicker).
//
// Mirrors the server-side AgentsResponse in src/eval-server/api-routes.ts.
// Kept here as a pure type (no backend import) to preserve the eval-ui
// tsconfig boundary.
// ---------------------------------------------------------------------------

export interface AgentScopeEntry {
  id: string;
  displayName: string;
  featureSupport: {
    slashCommands: boolean;
    hooks: boolean;
    mcp: boolean;
    customSystemPrompt: boolean;
  };
  isUniversal: boolean;
  parentCompany: string;
  detected: boolean;
  isDefault: boolean;
  localSkillCount: number;
  globalSkillCount: number;
  // 0772 US-002: plugin skills are a Claude-Code-only concept. Optional so
  // older server payloads (pre-0.5.139) don't fail typecheck — the adapter
  // defaults to 0 when absent.
  pluginSkillCount?: number;
  resolvedLocalDir: string;
  resolvedGlobalDir: string;
  lastSync: string | null;
  health: "ok" | "stale" | "missing";
  // 0694 (AC-US4-04): web-only agents (Devin, bolt.new, v0, Replit) carry
  // this flag so the UI renders a "Remote" badge and suppresses install
  // affordances. Optional so older server payloads don't fail typecheck.
  isRemoteOnly?: boolean;
}

export interface AgentsResponse {
  agents: AgentScopeEntry[];
  suggested: string;
  sharedFolders: Array<{ path: string; consumers: string[] }>;
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

/** 0734: authoring engine — peer choices (NOT a fallback chain). */
export type CreateSkillEngine = "vskill" | "anthropic-skill-creator" | "none";

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
  /** 0734: explicit version emitted in SKILL.md frontmatter. Defaults to "1.0.0" server-side. */
  version?: string;
  /** 0734: authoring engine. Defaults to "vskill" server-side. */
  engine?: CreateSkillEngine;
}

export interface CreateSkillResponse {
  ok: boolean;
  plugin: string;
  skill: string;
  dir: string;
  skillMdPath: string;
  version?: string;
  engine?: CreateSkillEngine;
  emittedTargets?: string[];
}

export interface DetectEnginesResponse {
  vskillSkillBuilder: boolean;
  anthropicSkillCreator: boolean;
  vskillVersion: string | null;
  anthropicPath: string | null;
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
  /** USD per 1M tokens (canonical wire unit; canonicalized server-side at /api/openrouter/models — see 0710). */
  pricing: { prompt: number; completion: number };
}

