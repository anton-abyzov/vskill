// API client for the eval server
import type { EvalsFile, SkillInfo, BenchmarkResult, HistorySummary, HistoryFilter, HistoryCompareResult, CaseHistoryEntry, ImproveResult, SmartEditResult, DependenciesResponse, StatsResult, ProjectLayoutResponse, CreateSkillRequest, CreateSkillResponse, SaveDraftRequest, SaveDraftResponse, SkillCreatorStatus, GenerateSkillResponse, SkillFileEntry, SkillFileContent, SweepResult, CredentialStatus, OpenRouterModel, VersionEntry, VersionDiff, AgentsResponse, StudioOp, Provenance, TransferEvent, SkillScope, SkillGroup, SkillSource, DetectEnginesResponse } from "./types";
import { resolveSkillVersion } from "./version-resolver.js";

// ---------------------------------------------------------------------------
// 0707 T-025: backend envelope types for the four hardened studio endpoints.
// These describe the wire shapes emitted by `src/eval-server/api-routes.ts`
// so UI components that need the envelope metadata (`source`, `exists`,
// `count`) can import them without guessing. Existing high-level getters
// (e.g. `getSkillVersions`) continue to return the flat collection shape for
// backward compatibility and unwrap the envelope internally — consumers that
// want the envelope metadata use the `*Envelope` variants.
// ---------------------------------------------------------------------------

/** Envelope returned by GET /api/skills/:plugin/:skill/versions. */
export interface SkillVersionsEnvelope {
  versions: VersionEntry[];
  count: number;
  /** "platform" = live data from Verified-Skill API, "none" = skill has no
   *  VCS surface (local fixture, platform unreachable). When "none" the
   *  response also carries header `X-Skill-VCS: unavailable`. */
  source: "platform" | "none";
}

/** Envelope returned by GET /api/skills/:plugin/:skill/evals. */
export type SkillEvalsEnvelope =
  | ({ exists: true } & EvalsFile)
  | { exists: false; evals: [] };

/** Envelope returned by GET /api/skills/:plugin/:skill/activation-history. */
export interface ActivationHistoryEnvelope {
  runs: Array<Record<string, unknown>>;
  count: number;
}

/** Envelope returned by GET /api/skills/:plugin/:skill/benchmark/latest. */
export type BenchmarkLatestEnvelope = BenchmarkResult | null;

// ---------------------------------------------------------------------------
// 0698 T-001: scope normalizer + derivation.
//
// The eval-server may return either legacy (`own`/`installed`/`global`) or new
// (5-value `SkillScope`) scope strings during the 0688 overlap. This boundary
// helper translates legacy → new so all UI consumers can rely on the new
// vocabulary. Unknown / missing input falls back to `"authoring-project"` —
// the safest default (visible to the user as their workspace, not silently
// promoted into AVAILABLE).
// ---------------------------------------------------------------------------

const LEGACY_SCOPE_MAP: Record<string, SkillScope> = {
  own: "authoring-project",
  installed: "available-project",
  global: "available-personal",
};

const NEW_SCOPES: ReadonlySet<SkillScope> = new Set<SkillScope>([
  "available-project",
  "available-personal",
  "available-plugin",
  "authoring-project",
  "authoring-plugin",
]);

export function normalizeSkillScope(raw: unknown): SkillScope {
  if (typeof raw === "string") {
    if (NEW_SCOPES.has(raw as SkillScope)) return raw as SkillScope;
    if (Object.prototype.hasOwnProperty.call(LEGACY_SCOPE_MAP, raw)) {
      return LEGACY_SCOPE_MAP[raw];
    }
  }
  return "authoring-project";
}

export function deriveScopeGroup(scope: SkillScope): SkillGroup {
  return scope.startsWith("available-") ? "available" : "authoring";
}

export function deriveScopeSource(scope: SkillScope): SkillSource {
  // Suffix after the first hyphen — guaranteed to be one of project/personal/plugin
  // by the SkillScope union definition.
  const idx = scope.indexOf("-");
  return scope.slice(idx + 1) as SkillSource;
}

const BASE = "";

export class ApiError extends Error {
  status: number;
  /** 0772 US-004: structured details forwarded from the server's JSON error
   *  body (e.g. `code`, `plugin`, `skill`). Optional — only populated when the
   *  server emits a structured payload. */
  details?: Record<string, unknown>;
  constructor(message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    // 0772 US-004: forward the entire JSON body as `details` so callers can
    // recover from structured error contracts (e.g. 409 skill-already-exists).
    const details =
      body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
    throw new ApiError(
      (body as { error?: string })?.error || `HTTP ${res.status}`,
      res.status,
      details,
    );
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 0761 US-003: one-shot retry for transient gateway 5xx (502/503/504). Used
// only for endpoints whose existing failure contract is `[]` graceful-degrade
// (currently `/api/v1/skills/check-updates`), so callers see the recovered
// response without changes to their happy-path handling.
//
// Why one shot: the platform's failure mode is short worker cold-starts; a
// single ~250ms retry recovers most blips. Repeated retries would stack load
// during a real outage. 4xx is deterministic and not retried.
// ---------------------------------------------------------------------------
async function fetchWith5xxRetry(
  input: RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status >= 502 && first.status <= 504) {
    await new Promise((r) => setTimeout(r, 250));
    return fetch(input, init);
  }
  return first;
}

// ---------------------------------------------------------------------------
// SkillInfo response normalization (T-021, T-025)
//
// The server is the SSoT for origin + frontmatter fields. These helpers act as
// a defensive boundary so downstream UI code (sidebar split, detail panel)
// never has to reason about missing/invalid values. Rules:
//   - `origin` MUST be "source" | "installed" — default "source" with console.warn
//   - Frontmatter scalar fields MUST be string | null — default null
//   - Frontmatter array fields MUST be string[] | null — default null
//   - Numeric stats (sizeBytes) MUST be number | null — default null
// ---------------------------------------------------------------------------

function coerceStringOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function coerceNumberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function coerceStringArrayOrNull(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const filtered = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return filtered.length > 0 ? filtered : null;
}

export function normalizeSkillInfo(raw: unknown): SkillInfo {
  const r = (raw ?? {}) as Record<string, unknown>;

  // Origin — T-021 guarantee: always "source" | "installed", never missing
  let origin: "source" | "installed";
  if (r.origin === "source" || r.origin === "installed") {
    origin = r.origin;
  } else {
    origin = "source";
    console.warn(
      `[api.getSkills] skill ${String(r.plugin)}/${String(r.skill)} has invalid origin=${JSON.stringify(r.origin)}; defaulting to 'source'`,
    );
  }

  // 0686: tri-scope (`scope`) + symlink transparency (`isSymlink`/
  // `symlinkTarget`/`installMethod`) — defaults preserve the pre-0686 shape.
  let scope: SkillInfo["scope"];
  if (r.scope === "own" || r.scope === "installed" || r.scope === "global") {
    scope = r.scope;
  } else {
    // Back-compat (AC-US3-02): missing scope defaults to OWN.
    scope = origin === "installed" ? "installed" : "own";
  }

  let installMethod: SkillInfo["installMethod"];
  if (
    r.installMethod === "authored" ||
    r.installMethod === "copied" ||
    r.installMethod === "symlinked"
  ) {
    installMethod = r.installMethod;
  } else {
    installMethod = scope === "own" ? "authored" : "copied";
  }

  // 0698 T-001: derive new scope vocabulary.
  // IMPORTANT: prefer the server-supplied `scopeV2` when present — plugin
  // scanners emit `scope: "installed"` for wire-compat but tag `scopeV2:
  // "available-plugin"` to distinguish plugin-cache skills from project skills.
  // The legacy `scope` field only tells us own/installed/global, which is
  // insufficient to distinguish plugin vs project vs personal at the UI layer.
  const scopeV2 =
    typeof r.scopeV2 === "string" && NEW_SCOPES.has(r.scopeV2 as SkillScope)
      ? (r.scopeV2 as SkillScope)
      : normalizeSkillScope(r.scope);
  const group = deriveScopeGroup(scopeV2);
  const source = deriveScopeSource(scopeV2);

  // 0698 T-001: precedence + shadowing metadata (server-computed).
  // precedenceRank: number-or-undefined (server may omit during transition).
  // shadowedBy: SkillScope | null when AVAILABLE; undefined for AUTHORING/plugin.
  const precedenceRank =
    typeof r.precedenceRank === "number" ? r.precedenceRank : undefined;
  let shadowedBy: SkillScope | null | undefined;
  if (r.shadowedBy === null) {
    shadowedBy = null;
  } else if (typeof r.shadowedBy === "string" && NEW_SCOPES.has(r.shadowedBy as SkillScope)) {
    shadowedBy = r.shadowedBy as SkillScope;
  } else {
    shadowedBy = undefined;
  }

  const info: SkillInfo = {
    plugin: typeof r.plugin === "string" ? r.plugin : "",
    skill: typeof r.skill === "string" ? r.skill : "",
    dir: typeof r.dir === "string" ? r.dir : "",
    hasEvals: Boolean(r.hasEvals),
    hasBenchmark: Boolean(r.hasBenchmark),
    evalCount: typeof r.evalCount === "number" ? r.evalCount : 0,
    assertionCount: typeof r.assertionCount === "number" ? r.assertionCount : 0,
    benchmarkStatus:
      r.benchmarkStatus === "pass" || r.benchmarkStatus === "fail" ||
      r.benchmarkStatus === "pending" || r.benchmarkStatus === "stale" ||
      r.benchmarkStatus === "missing"
        ? r.benchmarkStatus
        : "missing",
    lastBenchmark: typeof r.lastBenchmark === "string" ? r.lastBenchmark : null,
    origin,
    // 0686 tri-scope + symlink fields (legacy — kept for 0688 overlap)
    scope,
    isSymlink: typeof r.isSymlink === "boolean" ? r.isSymlink : false,
    symlinkTarget: coerceStringOrNull(r.symlinkTarget),
    installMethod,
    // 0769 T-009: editable upstream marketplace clone path. Always pass
    // through verbatim — server emits null when no clone exists.
    sourcePath: coerceStringOrNull(r.sourcePath),
    // 0698 T-001: new scope vocabulary + derivations + plugin metadata
    scopeV2,
    group,
    source,
    pluginName: coerceStringOrNull(r.pluginName),
    pluginNamespace: coerceStringOrNull(r.pluginNamespace),
    pluginMarketplace: coerceStringOrNull(r.pluginMarketplace),
    pluginManifestPath: coerceStringOrNull(r.pluginManifestPath),
    pluginVersion: coerceStringOrNull(r.pluginVersion),
    precedenceRank,
    shadowedBy,
    // T-025: frontmatter + filesystem fields (all | null)
    description: coerceStringOrNull(r.description),
    version: coerceStringOrNull(r.version),
    category: coerceStringOrNull(r.category),
    author: coerceStringOrNull(r.author),
    license: coerceStringOrNull(r.license),
    homepage: coerceStringOrNull(r.homepage),
    // 0737: source-repo provenance from the lockfile, drives the Studio
    // detail header's clickable GitHub anchor (DetailHeader byline).
    repoUrl: coerceStringOrNull(r.repoUrl),
    skillPath: coerceStringOrNull(r.skillPath),
    tags: coerceStringArrayOrNull(r.tags),
    deps: coerceStringArrayOrNull(r.deps),
    mcpDeps: coerceStringArrayOrNull(r.mcpDeps),
    entryPoint: coerceStringOrNull(r.entryPoint),
    lastModified: coerceStringOrNull(r.lastModified),
    sizeBytes: coerceNumberOrNull(r.sizeBytes),
    sourceAgent: coerceStringOrNull(r.sourceAgent),
  };

  // 0688: provenance sidecar passthrough — only when the server populated it
  // for an OWN-scope skill. Any malformed shape is coerced to null rather
  // than propagating garbage to the UI.
  if (r.provenance && typeof r.provenance === "object") {
    const p = r.provenance as Record<string, unknown>;
    if (
      (p.promotedFrom === "installed" || p.promotedFrom === "global") &&
      typeof p.sourcePath === "string" &&
      typeof p.promotedAt === "number"
    ) {
      info.provenance = {
        promotedFrom: p.promotedFrom,
        sourcePath: p.sourcePath,
        promotedAt: p.promotedAt,
        sourceSkillVersion:
          typeof p.sourceSkillVersion === "string" ? p.sourceSkillVersion : undefined,
      };
    } else {
      info.provenance = null;
    }
  } else if (r.provenance === null) {
    info.provenance = null;
  }

  // Preserve optional version-update fields passthrough (merged later by
  // mergeUpdatesIntoSkills — see bottom of file).
  if (typeof r.updateAvailable === "boolean") info.updateAvailable = r.updateAvailable;
  if (typeof r.currentVersion === "string") info.currentVersion = r.currentVersion;
  if (typeof r.latestVersion === "string") info.latestVersion = r.latestVersion;
  if (typeof r.pinnedVersion === "string") info.pinnedVersion = r.pinnedVersion;

  // Increment 0750: resolve a non-empty version string + provenance label
  // so the sidebar always shows a badge. `currentVersion` may be enriched
  // later by `mergeUpdatesIntoSkills`; that path re-runs resolution.
  // 0781: for installed skills, prefer `currentVersion` (lockfile/platform
  // truth) over the on-disk frontmatter so the sidebar matches the
  // Versions tab's [installed] marker.
  const resolved = resolveSkillVersion({
    frontmatterVersion: info.version ?? null,
    registryCurrentVersion: info.currentVersion ?? null,
    pluginVersion: info.pluginVersion ?? null,
    installedCurrentVersion: info.currentVersion ?? null,
    preferInstalled: info.origin === "installed",
  });
  info.resolvedVersion = resolved.version;
  info.versionSource = resolved.versionSource;

  return info;
}

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: "claude-cli" | "anthropic" | "ollama" | "openrouter" | "gemini-cli" | "codex-cli" | "lm-studio" | "openai";
  label: string;
  available: boolean;
  models: ModelOption[];
}

export interface ConfigResponse {
  provider: string | null;
  model: string;
  providers: ProviderInfo[];
  projectName: string | null;
  root: string;
  error?: string;
}

export const api = {
  getConfig(): Promise<ConfigResponse> {
    return fetchJson("/api/config");
  },

  setConfig(provider: string, model?: string): Promise<ConfigResponse> {
    return fetchJson("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model }),
    });
  },

  // 0686: getSkills() now accepts an optional filter. When `scope` or `agent`
  // is set, they're forwarded as query params so the server can apply the
  // tri-scope projection (own | installed | global) + agent ownership filter.
  async getSkills(filter?: { scope?: "own" | "installed" | "global"; agent?: string }): Promise<SkillInfo[]> {
    const params = new URLSearchParams();
    if (filter?.scope) params.set("scope", filter.scope);
    if (filter?.agent) params.set("agent", filter.agent);
    const qs = params.toString();
    const raw = await fetchJson<unknown[]>(`/api/skills${qs ? "?" + qs : ""}`);
    return Array.isArray(raw) ? raw.map(normalizeSkillInfo) : [];
  },

  // 0686: per-agent scope stats + shared-folder grouping for the
  // AgentScopePicker. Returns agents with filesystem presence only.
  getAgents(): Promise<AgentsResponse> {
    return fetchJson<AgentsResponse>("/api/agents");
  },

  getSkillDetail(plugin: string, skill: string): Promise<{ plugin: string; skill: string; skillContent: string }> {
    return fetchJson(`/api/skills/${plugin}/${skill}`);
  },

  // 0707 T-025: backend envelope is
  //   200 { exists: false, evals: [] }     when evals.json is missing
  //   200 { exists: true,  ...EvalsFile }  when valid
  //   422 { error, errors[] }              when malformed
  // For backward compatibility this helper returns `EvalsFile` directly —
  // callers that need `exists: false` vs malformed can use
  // `getEvalsEnvelope` instead. When `exists: false`, we return a
  // well-formed but empty EvalsFile so existing consumers don't NPE.
  async getEvals(plugin: string, skill: string): Promise<EvalsFile> {
    const env = await fetchJson<SkillEvalsEnvelope | EvalsFile>(
      `/api/skills/${plugin}/${skill}/evals`,
    );
    if (env && typeof env === "object" && "exists" in env) {
      if (env.exists === false) {
        return { skill_name: skill, evals: [] } as EvalsFile;
      }
      // exists: true — envelope spreads EvalsFile fields on the root.
      // Strip `exists` before returning to callers.
      const { exists: _exists, ...rest } = env;
      return rest as EvalsFile;
    }
    // Legacy shape (no `exists` field) — return as-is.
    return env as EvalsFile;
  },

  getEvalsEnvelope(
    plugin: string,
    skill: string,
  ): Promise<SkillEvalsEnvelope> {
    return fetchJson(`/api/skills/${plugin}/${skill}/evals`);
  },

  getActivationHistoryEnvelope(
    plugin: string,
    skill: string,
  ): Promise<ActivationHistoryEnvelope> {
    return fetchJson(`/api/skills/${plugin}/${skill}/activation-history`);
  },

  saveEvals(plugin: string, skill: string, data: EvalsFile): Promise<EvalsFile> {
    return fetchJson(`/api/skills/${plugin}/${skill}/evals`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  generateEvals(plugin: string, skill: string): Promise<EvalsFile> {
    return fetchJson(`/api/skills/${plugin}/${skill}/generate-evals`, {
      method: "POST",
    });
  },

  async getLatestBenchmark(plugin: string, skill: string): Promise<BenchmarkResult | null> {
    // 0704: the server now returns 200 null when no benchmark has been
    // persisted (instead of 404). res.json() yields null in that case.
    const res = await fetch(`${BASE}/api/skills/${plugin}/${skill}/benchmark/latest`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(body.error || `HTTP ${res.status}`, res.status);
    }
    return res.json();
  },

  getHistory(plugin: string, skill: string, filters?: HistoryFilter): Promise<HistorySummary[]> {
    const params = new URLSearchParams();
    if (filters?.model) params.set("model", filters.model);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    const qs = params.toString();
    return fetchJson(`/api/skills/${plugin}/${skill}/history${qs ? "?" + qs : ""}`);
  },

  getHistoryEntry(plugin: string, skill: string, timestamp: string): Promise<BenchmarkResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history/${encodeURIComponent(timestamp)}`);
  },

  compareRuns(plugin: string, skill: string, a: string, b: string): Promise<HistoryCompareResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history-compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  },

  getCaseHistory(plugin: string, skill: string, evalId: number, model?: string): Promise<CaseHistoryEntry[]> {
    const params = new URLSearchParams();
    if (model) params.set("model", model);
    const qs = params.toString();
    return fetchJson(`/api/skills/${plugin}/${skill}/history/case/${evalId}${qs ? "?" + qs : ""}`);
  },

  deleteHistoryEntry(plugin: string, skill: string, timestamp: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/history/${encodeURIComponent(timestamp)}`, {
      method: "DELETE",
    });
  },

  deleteSkill(plugin: string, skill: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}`, { method: "DELETE" });
  },

  // 0780 — uninstall an installed (lockfile-tracked) skill. Symmetric to
  // `vskill install`: removes the lockfile entry AND trashes the on-disk
  // dir. Does NOT touch source-authored skills (use deleteSkill for those).
  uninstallSkill(plugin: string, skill: string): Promise<{
    ok: boolean;
    removedFromLockfile: boolean;
    trashedDir: string | null;
  }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/uninstall`, { method: "POST" });
  },

  improveSkill(plugin: string, skill: string, opts: { provider?: string; model?: string; eval_id?: number; notes?: string }): Promise<ImproveResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  },

  instructEdit(plugin: string, skill: string, opts: { instruction: string; content: string; evals?: EvalsFile; provider?: string; model?: string }): Promise<SmartEditResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "instruct", ...opts }),
    });
  },

  applyImprovement(plugin: string, skill: string, content: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/apply-improvement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  },

  getStats(plugin: string, skill: string): Promise<StatsResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/stats`);
  },

  getDependencies(plugin: string, skill: string): Promise<DependenciesResponse> {
    return fetchJson(`/api/skills/${plugin}/${skill}/dependencies`);
  },

  getProjectLayout(): Promise<ProjectLayoutResponse> {
    return fetchJson("/api/project-layout");
  },

  // 0772 US-005: GitHub status for the publish-readiness hint card.
  getProjectGitHubStatus(): Promise<{
    hasGit: boolean;
    githubOrigin: string | null;
    status: "no-git" | "non-github" | "github";
  }> {
    return fetchJson("/api/project/github-status");
  },

  createSkill(data: CreateSkillRequest): Promise<CreateSkillResponse> {
    return fetchJson("/api/skills/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  detectEngines(): Promise<DetectEnginesResponse> {
    return fetchJson("/api/studio/detect-engines");
  },

  saveDraft(data: SaveDraftRequest): Promise<SaveDraftResponse> {
    return fetchJson("/api/skills/save-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  },

  getSkillCreatorStatus(): Promise<SkillCreatorStatus> {
    return fetchJson("/api/skill-creator-status");
  },

  generateSkill(opts: { prompt: string; provider?: string; model?: string }): Promise<GenerateSkillResponse> {
    return fetchJson("/api/skills/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
  },

  getSkillFiles(plugin: string, skill: string): Promise<{ files: SkillFileEntry[] }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/files`);
  },

  getSkillFile(plugin: string, skill: string, path: string): Promise<SkillFileContent> {
    return fetchJson(`/api/skills/${plugin}/${skill}/file?path=${encodeURIComponent(path)}`);
  },

  saveSkillFile(plugin: string, skill: string, path: string, content: string): Promise<{ ok: boolean; path: string; size: number }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  },

  // ---------------------------------------------------------------------------
  // Leaderboard / Sweep (T-055)
  // ---------------------------------------------------------------------------

  getLeaderboard(plugin: string, skill: string): Promise<{ entries: SweepResult[] }> {
    return fetchJson(`/api/skills/${plugin}/${skill}/leaderboard`);
  },

  getLeaderboardEntry(plugin: string, skill: string, timestamp: string): Promise<SweepResult> {
    return fetchJson(`/api/skills/${plugin}/${skill}/leaderboard/${encodeURIComponent(timestamp)}`);
  },

  startSweep(plugin: string, skill: string, body: { models: string[]; judge: string; runs?: number; concurrency?: number }): EventSource {
    const url = `${BASE}/api/skills/${plugin}/${skill}/sweep`;
    const es = new EventSource(url);
    // POST-based SSE: use fetch instead and return an EventSource-like object
    // The backend expects POST, so we use fetch with ReadableStream
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    return es;
  },

  // ---------------------------------------------------------------------------
  // Credentials (T-055)
  // ---------------------------------------------------------------------------

  getCredentials(plugin: string, skill: string): Promise<{ credentials: CredentialStatus[] }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}`);
  },

  setCredential(plugin: string, skill: string, name: string, value: string): Promise<{ ok: boolean; credential: CredentialStatus }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    });
  },

  getParams(plugin: string, skill: string): Promise<{ params: Array<{ name: string; maskedValue: string; value?: string; status: string }> }> {
    return fetchJson(`/api/credentials/${plugin}/${skill}/params`);
  },

  getParamsRevealed(plugin: string, skill: string, key?: string): Promise<{ params: Array<{ name: string; maskedValue: string; value?: string; status: string }> }> {
    const qs = key ? `reveal=true&key=${encodeURIComponent(key)}` : "reveal=true";
    return fetchJson(`/api/credentials/${plugin}/${skill}/params?${qs}`);
  },

  // ---------------------------------------------------------------------------
  // OpenRouter models (T-055)
  // ---------------------------------------------------------------------------

  searchModels(): Promise<{ models: OpenRouterModel[] }> {
    return fetchJson("/api/openrouter/models");
  },

  // ---------------------------------------------------------------------------
  // Version lifecycle (Phase 2)
  // ---------------------------------------------------------------------------

  // 0707 T-025: /versions now returns an envelope
  // `{ versions, count, source }`. This helper unwraps to the flat
  // `VersionEntry[]` for backward compatibility with `VersionHistoryPanel`
  // and other legacy consumers. Use `getSkillVersionsEnvelope` when the
  // `source` / `X-Skill-VCS` metadata is needed (e.g. to badge a skill as
  // "no version history").
  async getSkillVersions(plugin: string, skill: string): Promise<VersionEntry[]> {
    const env = await fetchJson<SkillVersionsEnvelope | VersionEntry[]>(
      `/api/skills/${plugin}/${skill}/versions`,
    );
    // Tolerate either envelope or legacy array payloads (useful during the
    // cross-workstream rollout window).
    if (Array.isArray(env)) return env;
    return Array.isArray(env.versions) ? env.versions : [];
  },

  getSkillVersionsEnvelope(
    plugin: string,
    skill: string,
  ): Promise<SkillVersionsEnvelope> {
    return fetchJson(`/api/skills/${plugin}/${skill}/versions`);
  },

  getVersionDiff(plugin: string, skill: string, from: string, to: string): Promise<VersionDiff> {
    return fetchJson(`/api/skills/${plugin}/${skill}/versions/diff?from=${from}&to=${to}`);
  },

  startBatchUpdate(skills: string[]): EventSource {
    const url = `${BASE}/api/skills/batch-update`;
    const es = new EventSource(url);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ skills }),
    });
    return es;
  },

  /**
   * @deprecated 0736 F-007: this dual-channel pattern (EventSource GET + side-channel POST)
   * was the source of ERR_CONNECTION_REFUSED on the update-click flow — the GET hits a
   * POST-only endpoint and silently fails, surfacing as a "Stream error" toast.
   *
   * Use `postSkillUpdate(plugin, skill, signal?)` instead — single POST, structured
   * `{ ok, status, body, version }` result, AbortSignal support for unmount cancellation.
   *
   * Retained only because the test suite spies on this function as an anti-pattern guard
   * (asserting the new code paths do NOT call it). No production code path references it.
   * Safe to remove once the test mocks no longer need the symbol.
   */
  startSkillUpdate(plugin: string, skill: string): EventSource {
    const url = `${BASE}/api/skills/${plugin}/${skill}/update`;
    const es = new EventSource(url);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    });
    return es;
  },

  /**
   * 0736 US-001: single-skill update via POST (replaces the broken EventSource
   * side-channel in startSkillUpdate). Returns a structured result so callers
   * can render inline progress without an SSE stream.
   *
   * Accepts an optional AbortSignal so callers can cancel an in-flight update
   * on unmount. AbortError is propagated to the caller (see UpdateAction.tsx
   * which silently ignores AbortError because the component is gone).
   */
  async postSkillUpdate(
    plugin: string,
    skill: string,
    signalOrOpts?: AbortSignal | { signal?: AbortSignal; agentId?: string },
  ): Promise<{
    ok: boolean;
    status: number;
    body: string;
    version: string | undefined;
  }> {
    // 0747 T-010: backwards-compat — second arg may be a plain AbortSignal
    // (legacy call sites) OR an options object with `agentId` for per-location
    // update via `?agent=<id>` query param.
    let signal: AbortSignal | undefined;
    let agentId: string | undefined;
    if (signalOrOpts && typeof (signalOrOpts as AbortSignal).aborted === "boolean") {
      signal = signalOrOpts as AbortSignal;
    } else if (signalOrOpts && typeof signalOrOpts === "object") {
      const opts = signalOrOpts as { signal?: AbortSignal; agentId?: string };
      signal = opts.signal;
      agentId = opts.agentId;
    }
    const qs = agentId ? `?agent=${encodeURIComponent(agentId)}` : "";
    const url = `${BASE}/api/skills/${plugin}/${skill}/update${qs}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
    });
    // F-010: stream SSE frames as they arrive instead of buffering the full
    // body via res.text(). This allows the backend's per-step progress events
    // to flow through without blocking until the connection closes. Version is
    // extracted from the last "done" event in the stream.
    let version: string | undefined;
    let bodyExcerpt = "";
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          const text = decoder.decode(chunk.value, { stream: !done });
          accumulated += text;
          if (bodyExcerpt.length < 200) {
            bodyExcerpt += text;
          }
        }
      }
      // Parse the last "done" event from the accumulated SSE frames.
      const doneMatch = accumulated.match(/event:\s*done[\s\S]*?data:\s*(\{[^\n]+\})/);
      if (doneMatch) {
        try {
          const parsed = JSON.parse(doneMatch[1]) as { version?: string };
          version = parsed.version;
        } catch { /* noop */ }
      }
      bodyExcerpt = bodyExcerpt.slice(0, 200);
    } else {
      // Fallback for environments where ReadableStream body is unavailable.
      const rawBody = await res.text();
      bodyExcerpt = rawBody.slice(0, 200);
      const doneMatch = rawBody.match(/event:\s*done[\s\S]*?data:\s*(\{[^\n]+\})/);
      if (doneMatch) {
        try {
          const parsed = JSON.parse(doneMatch[1]) as { version?: string };
          version = parsed.version;
        } catch { /* noop */ }
      }
    }
    return { ok: res.ok, status: res.status, body: bodyExcerpt, version };
  },

  /**
   * 0708 AC-US8-01: request an upstream rescan for a tracked skill. The
   * server enqueues a `scan-high` job and returns `{jobId}` (HTTP 202). Actual
   * result arrives later via the same `skill.updated` SSE channel the Studio
   * is already subscribed to — see `CheckNowButton` for the spinner contract.
   */
  async rescanSkill(plugin: string, skill: string): Promise<{ jobId: string }> {
    const id = `${plugin}/${skill}`;
    const res = await fetch(`${BASE}/api/v1/skills/${encodeURIComponent(id)}/rescan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`rescan failed: HTTP ${res.status}`);
    }
    return (await res.json()) as { jobId: string };
  },

  // ---------------------------------------------------------------------------
  // Skill updates (version awareness)
  // ---------------------------------------------------------------------------

  async getSkillUpdates(): Promise<SkillUpdateInfo[]> {
    try {
      const res = await fetch(`${BASE}/api/skills/updates`);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  },

  /**
   * 0708 T-059: Reconciliation endpoint. Returns the set of updates visible
   * from the server for the given skill IDs — used by `useSkillUpdates` when
   * (a) SSE fallback poll is active, or (b) a `gone` frame / 409 arrives and
   * the hook needs to resync without trusting the SSE stream.
   *
   * Shape matches `UpdateStoreEntry` so the hook can merge results directly.
   */
  async checkSkillUpdates(skillIds: string[]): Promise<Array<{
    skillId: string;
    version: string;
    eventId: string;
    publishedAt: string;
    diffSummary?: string;
    trackedForUpdates?: boolean;
    updateAvailable?: boolean;
    installed?: string;
    latest?: string;
    name?: string;
  }>> {
    if (skillIds.length === 0) return [];
    try {
      // 0712 US-003 T-016D: the vskill-platform's `/api/v1/skills/check-updates`
      // endpoint is POST-only — sending GET returns 405 Method Not Allowed
      // (verified end-to-end against `wrangler dev` on port 3017). Send the
      // skill list as a JSON body. The proxy in `src/eval-server/platform-proxy.ts`
      // forwards the body verbatim, and the response shape is the
      // `{results: [...]}` envelope handled below.
      //
      // 0741 follow-up: the platform handler at `route.ts:141-151` requires
      // each entry to be an OBJECT with `name` + `currentVersion`. Sending
      // bare strings made every entry get filtered to [], so reconcile was
      // silently a no-op. Reconcile callers only have IDs — version is
      // backfilled by the polling/SSE merge once it lands. Use "0.0.0" as a
      // placeholder so the platform always has at least a comparable string.
      const sortedIds = [...skillIds].sort();
      const res = await fetchWith5xxRetry(`${BASE}/api/v1/skills/check-updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skills: sortedIds.map((name) => ({ name, currentVersion: "0.0.0" })),
        }),
      });
      if (!res.ok) return [];
      const body = await res.json().catch(() => null);
      // 0708 wrap-up: accept both the flat-array shape (legacy reconcile
      // contract) AND the `{results: [...]}` envelope used by the platform's
      // POST /skills/check-updates handler. The latter carries the
      // `trackedForUpdates` flag that drives AC-US5-09.
      if (Array.isArray(body)) return body;
      if (body && typeof body === "object" && Array.isArray((body as { results?: unknown[] }).results)) {
        return (body as { results: Array<Record<string, unknown>> }).results.map((r) => ({
          skillId: typeof r.skillId === "string" ? r.skillId : (typeof r.name === "string" ? r.name : ""),
          version: typeof r.version === "string" ? r.version : (typeof r.latest === "string" ? r.latest : ""),
          eventId: typeof r.eventId === "string" ? r.eventId : "",
          publishedAt: typeof r.publishedAt === "string" ? r.publishedAt : "",
          diffSummary: typeof r.diffSummary === "string" ? r.diffSummary : undefined,
          trackedForUpdates:
            typeof r.trackedForUpdates === "boolean" ? r.trackedForUpdates : undefined,
          updateAvailable:
            typeof r.updateAvailable === "boolean" ? r.updateAvailable : undefined,
          installed: typeof r.installed === "string" ? r.installed : undefined,
          latest: typeof r.latest === "string" ? r.latest : undefined,
          name: typeof r.name === "string" ? r.name : undefined,
        }));
      }
      return [];
    } catch (err) {
      const SKILL_UPDATE_DEBUG = false;
      if (SKILL_UPDATE_DEBUG) {
        // eslint-disable-next-line no-console
        console.warn("[studio] checkSkillUpdates failed:", err instanceof Error ? err.message : String(err));
      }
      return [];
    }
  },

  /**
   * 0736 AC-US3-01: Resolve installed skills to their platform UUID/slug so
   * `useSkillUpdates` can build a valid SSE subscription filter.
   *
   * POSTs to `/api/v1/skills/check-updates` (already proxied to the platform
   * by platform-proxy.ts) with the skill names. The enriched response (once
   * vskill-platform ships the 0736 backend change) includes `id` (UUID) and
   * `slug` per result. Until then, both fields are absent and callers
   * gracefully degrade — unresolvable skills are omitted from the SSE filter
   * (AC-US3-02) and covered by the polling fallback.
   *
   * Input: array of `{ name, plugin, skill }` where `name` is the canonical
   * platform skill name (e.g. `acme/myrepo/greet-anton`) and `plugin`/`skill`
   * are the local filesystem identifiers.
   */
  async resolveInstalledSkillIds(
    skills: Array<{ name: string; plugin: string; skill: string; currentVersion?: string }>,
  ): Promise<Array<{ plugin: string; skill: string; uuid?: string; slug?: string }>> {
    if (skills.length === 0) return [];
    try {
      const res = await fetchWith5xxRetry(`${BASE}/api/v1/skills/check-updates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          skills: skills.map((s) => ({
            name: s.name,
            currentVersion: s.currentVersion ?? "0.0.0",
          })),
        }),
      });
      if (!res.ok) return skills.map((s) => ({ plugin: s.plugin, skill: s.skill }));
      const body = await res.json().catch(() => null);
      const results: Array<Record<string, unknown>> = Array.isArray(body)
        ? body
        : Array.isArray((body as { results?: unknown[] } | null)?.results)
          ? (body as { results: Array<Record<string, unknown>> }).results
          : [];
      // Build lookup: platform skill name → enriched result
      const byName = new Map(results.map((r) => [r.name as string, r]));
      return skills.map((s) => {
        const r = byName.get(s.name);
        return {
          plugin: s.plugin,
          skill: s.skill,
          uuid: typeof r?.id === "string" && r.id.length > 0 ? r.id : undefined,
          slug: typeof r?.slug === "string" && r.slug.length > 0 ? r.slug : undefined,
        };
      });
    } catch (err) {
      const SKILL_UPDATE_DEBUG = false;
      if (SKILL_UPDATE_DEBUG) {
        // eslint-disable-next-line no-console
        console.warn("[studio] resolveInstalledSkillIds failed:", err instanceof Error ? err.message : String(err));
      }
      return skills.map((s) => ({ plugin: s.plugin, skill: s.skill }));
    }
  },

  // ---------------------------------------------------------------------------
  // 0688: Studio scope-transfer endpoints (T-018)
  //
  // promote / test-install / revert are POST-initiated SSE streams. Each
  // returns a Promise that resolves with the final TransferEvent of type
  // "done" (or rejects on `error` / HTTP error). Per-event progress is
  // delivered via the optional `onEvent` callback so the caller can drive
  // FLIP captures, refresh, and toast emission at the right moments.
  // ---------------------------------------------------------------------------

  promoteSkill(
    plugin: string,
    skill: string,
    opts?: { overwrite?: boolean; onEvent?: (evt: TransferEvent) => void; signal?: AbortSignal },
  ): Promise<Extract<TransferEvent, { type: "done" }>> {
    const qs = opts?.overwrite ? "?overwrite=true" : "";
    return runTransferSSE(
      `/api/skills/${plugin}/${skill}/promote${qs}`,
      opts?.onEvent,
      opts?.signal,
    );
  },

  testInstallSkill(
    plugin: string,
    skill: string,
    opts?: {
      dest?: "installed" | "global";
      overwrite?: boolean;
      onEvent?: (evt: TransferEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<Extract<TransferEvent, { type: "done" }>> {
    const params = new URLSearchParams();
    if (opts?.dest === "global") params.set("dest", "global");
    if (opts?.overwrite) params.set("overwrite", "true");
    const qs = params.toString();
    return runTransferSSE(
      `/api/skills/${plugin}/${skill}/test-install${qs ? "?" + qs : ""}`,
      opts?.onEvent,
      opts?.signal,
    );
  },

  revertSkill(
    plugin: string,
    skill: string,
    opts?: { onEvent?: (evt: TransferEvent) => void; signal?: AbortSignal },
  ): Promise<Extract<TransferEvent, { type: "done" }>> {
    return runTransferSSE(
      `/api/skills/${plugin}/${skill}/revert`,
      opts?.onEvent,
      opts?.signal,
    );
  },

  listStudioOps(opts?: { before?: number; limit?: number }): Promise<StudioOp[]> {
    const params = new URLSearchParams();
    if (opts?.before != null) params.set("before", String(opts.before));
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return fetchJson<StudioOp[]>(`/api/studio/ops${qs ? "?" + qs : ""}`);
  },

  deleteStudioOp(id: string): Promise<{ ok: boolean }> {
    return fetchJson(`/api/studio/ops/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  /**
   * Open a long-lived SSE stream of new StudioOp events. Returns a native
   * EventSource — caller is responsible for closing it. Listen on the "op"
   * event for new entries and "heartbeat" for keepalive.
   */
  studioOpsStream(): EventSource {
    return new EventSource(`${BASE}/api/studio/ops/stream`);
  },

  // 0759: minimum-viable publish flow. Probe of git state + real push.
  // 0759 Phase 5: dirty-detection + AI-generated commit message reusing the
  // user's configured studio provider/model.
  gitRemote(): Promise<{ remoteUrl: string | null; branch: string | null; hasRemote: boolean }> {
    return fetchJson("/api/git/remote");
  },

  gitDiff(): Promise<{ hasChanges: boolean; diff: string; fileCount: number }> {
    return fetchJson("/api/git/diff", { method: "POST" });
  },

  // 0759 Phase 6: lightweight porcelain probe — returns the file paths
  // (status prefix already stripped). Sidebar polls this to highlight
  // skills with uncommitted changes.
  gitStatus(): Promise<{ paths: string[] }> {
    return fetchJson("/api/git/status");
  },

  gitCommitMessage(opts?: { provider?: string; model?: string }): Promise<{ message: string }> {
    return fetchJson("/api/git/commit-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
  },

  gitPublish(opts?: { commitMessage?: string }): Promise<{
    success: boolean;
    commitSha: string | null;
    branch: string | null;
    remoteUrl: string | null;
    stdout: string;
    stderr: string;
  }> {
    return fetchJson("/api/git/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts ?? {}),
    });
  },
};

// ---------------------------------------------------------------------------
// 0688: Internal SSE-POST helper for the three transfer endpoints.
//
// Mirrors the parser in src/eval-ui/src/sse.ts but resolves a single Promise
// instead of accumulating React state. Each transfer is a one-shot with a
// well-defined event sequence; surfacing it as Promise<done> + onEvent
// callback maps cleanly onto the orchestration in useScopeTransfer.
// ---------------------------------------------------------------------------
export async function runTransferSSE(
  url: string,
  onEvent?: (evt: TransferEvent) => void,
  signal?: AbortSignal,
): Promise<Extract<TransferEvent, { type: "done" }>> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
      if (typeof j.code === "string") code = j.code;
    } catch {}
    const err = new ApiError(msg, res.status) as ApiError & { code?: string };
    if (code) err.code = code;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let doneEvent: Extract<TransferEvent, { type: "done" }> | null = null;
  let errorEvent: Extract<TransferEvent, { type: "error" }> | null = null;

  while (true) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(line.slice(6));
        } catch {
          currentEvent = "";
          continue;
        }
        if (
          currentEvent === "started" ||
          currentEvent === "copied" ||
          currentEvent === "deleted" ||
          currentEvent === "indexed" ||
          currentEvent === "done" ||
          currentEvent === "error"
        ) {
          const evt = { type: currentEvent, ...payload } as TransferEvent;
          onEvent?.(evt);
          if (evt.type === "done") doneEvent = evt;
          if (evt.type === "error") errorEvent = evt;
        }
        currentEvent = "";
      }
    }
  }

  if (errorEvent) {
    const err = new ApiError(errorEvent.message, 500) as ApiError & { code?: string };
    err.code = errorEvent.code;
    throw err;
  }
  if (!doneEvent) {
    throw new ApiError("Transfer stream ended without 'done' event", 500);
  }
  return doneEvent;
}

/**
 * 0747 T-004: An install location for a skill across one of {project,
 * personal, plugin} scopes for one of the registered agents (claude-code,
 * codex, cursor, ...). Returned by the backend's `scanSkillInstallLocations`
 * and surfaced in the Studio's Update tooltip + chip strip.
 */
export interface InstallLocation {
  scope: "project" | "personal" | "plugin";
  /** AgentDefinition.id, e.g. "claude-code", "codex", "cursor". */
  agent: string;
  /** Human-readable agent name, e.g. "Claude Code". */
  agentLabel: string;
  /** Absolute path to the skill folder containing SKILL.md. */
  dir: string;
  /** Set when scope === "plugin". */
  pluginSlug?: string;
  pluginMarketplace?: string;
  /** True when this location is a symlink to canonical .agents/skills/<name>/. */
  symlinked: boolean;
  /** True for plugin-bundled (read-only) installs. Update is blocked. */
  readonly: boolean;
}

export interface SkillUpdateInfo {
  name: string;
  installed: string;
  latest: string | null;
  updateAvailable: boolean;
  /**
   * 0708 AC-US5-09: Server-reported tracking state. `true` when the platform
   * has a `sourceRepoUrl` recorded for the skill; `false` means the user must
   * run `vskill outdated` manually. Optional for legacy compat — when absent,
   * consumers default to "tracked" (avoids spamming the not-tracked dot on
   * payloads that predate 0708).
   */
  trackedForUpdates?: boolean;
  /** 0747: pin metadata mirrored from server. */
  pinned?: boolean;
  pinnedVersion?: string;
  /**
   * 0747 T-002/T-004: backend-provided install locations across all registered
   * agents (project + personal scopes) plus plugin cache. Optional for
   * backwards-compat with older eval-server builds — UI MUST gracefully
   * degrade when absent.
   */
  installLocations?: InstallLocation[];
  /**
   * 0747: highest-precedence install's local fs identifiers, suitable for
   * `revealSkill(plugin, skill)` to scroll the matching sidebar row into
   * view. `localPlugin` may be omitted when the highest-precedence install
   * has no plugin context (project/personal scope without a plugin layer).
   */
  localPlugin?: string;
  localSkill?: string;
}

/**
 * Merge update info into SkillInfo array.
 *
 * 0740 contract — gate by origin + match by full identity:
 *   - Only rows with `origin === "installed"` are eligible. Authoring rows
 *     (the user's own SKILL.md sources) never inherit `updateAvailable`,
 *     even when their leaf name matches an outdated entry. Without this
 *     gate, ALL `obsidian-brain` rows in the sidebar showed the ↑ glyph.
 *   - When the SkillUpdateInfo's `name` carries plugin scope
 *     (`owner/repo/skill`), prefer matching `<pluginName>/<skill>` over
 *     bare leaf so two installed skills sharing a leaf name from different
 *     plugins stay distinct.
 *   - Bare-leaf match remains the fallback (back-compat for legacy
 *     payloads that omit a plugin scope).
 */
/**
 * 0766 F-004: strict semver greater-or-equal compare. Returns true when `a`
 * is the same as or newer than `b`. Falsy / malformed inputs return false
 * so the caller falls back to the existing "trust the update record" path.
 */
function isVersionAtOrAhead(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const re = /^(\d+)\.(\d+)\.(\d+)/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (!ma || !mb) return false;
  const [, a1, a2, a3] = ma.map(Number) as unknown as [unknown, number, number, number];
  const [, b1, b2, b3] = mb.map(Number) as unknown as [unknown, number, number, number];
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 >= b3;
}

export function mergeUpdatesIntoSkills(
  skills: SkillInfo[],
  updates: SkillUpdateInfo[],
): SkillInfo[] {
  if (!updates.length) return skills;

  // Two lookups:
  //   `fullKeyLookup` — `<pluginScope>/<leaf>` for plugin-scoped updates.
  //   `leafLookup` — bare leaf for the case where a row has no pluginName.
  //
  // Match policy: rows with `pluginName` MUST match via fullKeyLookup or get
  // no merge — this prevents a plugin-scoped update from polluting every
  // same-leaf row in OTHER plugins. Rows without `pluginName` fall back to
  // leaf (covers the umbrella + project-scoped install case where the row
  // doesn't carry a plugin scope).
  const fullKeyLookup = new Map<string, SkillUpdateInfo>();
  const leafLookup = new Map<string, SkillUpdateInfo>();
  for (const u of updates) {
    const segments = u.name.split("/");
    const leaf = segments.pop() || u.name;
    leafLookup.set(leaf, u);
    if (segments.length >= 1) {
      const pluginSegment = segments[segments.length - 1];
      fullKeyLookup.set(`${pluginSegment}/${leaf}`, u);
    }
  }

  return skills.map((s) => {
    if (s.origin !== "installed") return s;
    let u: SkillUpdateInfo | undefined;
    if (s.pluginName) {
      // Strict: a plugin-scoped row only matches its own plugin scope. This
      // prevents leaf-name collisions across plugins.
      u = fullKeyLookup.get(`${s.pluginName}/${s.skill}`);
    } else {
      // No plugin scope on the row — leaf match is the only option.
      u = leafLookup.get(s.skill);
    }
    if (!u) return s;
    // 0766 F-004: if the on-disk frontmatter version is already at or beyond
    // the polling result's `latest`, suppress `updateAvailable`. Without
    // this, after a successful update + refreshSkills lands but BEFORE
    // refreshUpdates lands, the merge would re-stamp updateAvailable: true
    // from the stale poll, making the "Update to <X>" button + bell flicker
    // back. The defense is also useful when the poll is simply behind for
    // any reason (network lag, server cache).
    const updateAvailable = u.updateAvailable && !isVersionAtOrAhead(s.version, u.latest);
    const merged: SkillInfo = {
      ...s,
      updateAvailable,
      currentVersion: u.installed,
      latestVersion: u.latest ?? undefined,
    };
    // 0708 AC-US5-09: surface server-reported tracking state so the
    // SidebarSection / RightPanel can render the "not tracked" dot. Only
    // propagate when the server actually returned the field — preserves
    // legacy "tracked by default" behaviour for older payloads.
    if (typeof u.trackedForUpdates === "boolean") {
      merged.trackedForUpdates = u.trackedForUpdates;
    }
    // Increment 0750: re-resolve version after enriching `currentVersion`
    // so the sidebar reflects registry-provided versions when frontmatter
    // is absent.
    // 0781: this path only runs for `origin === "installed"` (see early return
    // above), so `preferInstalled: true` is unconditional here.
    const reresolved = resolveSkillVersion({
      frontmatterVersion: merged.version ?? null,
      registryCurrentVersion: merged.currentVersion ?? null,
      pluginVersion: merged.pluginVersion ?? null,
      installedCurrentVersion: merged.currentVersion ?? null,
      preferInstalled: true,
    });
    merged.resolvedVersion = reresolved.version;
    merged.versionSource = reresolved.versionSource;
    return merged;
  });
}
