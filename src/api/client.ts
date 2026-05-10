// ---------------------------------------------------------------------------
// HTTP client for verified-skill.com API
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import {
  getDefaultKeychain,
  type Keychain,
} from "../lib/keychain.js";
import { getActiveTenant } from "../lib/active-tenant.js";

// Base URL is overridable via `VSKILL_API_BASE` so tests (and hermetic CI runs)
// can point the CLI at a mock server without touching the production host.
// Resolved lazily so test env mutation is always picked up.
const DEFAULT_BASE_URL = "https://verified-skill.com";
function resolveBaseUrl(): string {
  return process.env.VSKILL_API_BASE || DEFAULT_BASE_URL;
}

// ---------------------------------------------------------------------------
// 0839 US-001 / US-005 — Bearer interceptor + tenant header.
//
// Policy (ADR-001 + AC-US1-01..06, AC-US2-06, AC-US5-04):
//   * Prefer the verified-skill `vsk_*` token over the raw GitHub `gho_*`.
//     `requireUserOrGithubBearer` (vskill-platform) accepts both, but
//     `vsk_*` is our property — scopes, TTL, revocation. Falls back to
//     `gho_*` only when `vsk_*` is missing (legacy login or mid-rollout).
//   * Anonymous flow preserved: when neither token is present, no
//     Authorization header is sent. Public endpoints continue to work.
//   * Token is read from the keychain at most once per process, then
//     cached. Keychain reads are not free (libsecret on Linux is slow);
//     a long-running CLI command may make many requests.
//   * Tenant header: when an active tenant is configured (env or
//     `~/.vskill/config.json`), every request carries
//     `X-Vskill-Tenant: <slug>`. The platform routes are tenant-aware
//     today; this header is additive and harmless when ignored.
//   * Both caches are invalidatable for tests via the
//     `_resetClientAuthCacheForTests` hook.
// ---------------------------------------------------------------------------

interface AuthCacheState {
  token: string | null;
  tenant: string | null;
  loaded: boolean;
}

const _authCache: AuthCacheState = {
  token: null,
  tenant: null,
  loaded: false,
};

/**
 * Test-only override for the keychain provider. Production code never
 * reaches this path; tests inject a fake to avoid touching @napi-rs/keyring
 * or the on-disk fallback.
 */
let _keychainOverride: Keychain | null = null;

/** @internal — test hook. */
export function _setKeychainForTests(k: Keychain | null): void {
  _keychainOverride = k;
}

/** @internal — test hook. Forces the next request to re-read keychain + config. */
export function _resetClientAuthCacheForTests(): void {
  _authCache.token = null;
  _authCache.tenant = null;
  _authCache.loaded = false;
}

/**
 * 0839 F-004 — production-grade cache invalidation.
 *
 * The auth cache (`_authCache`) loads BOTH the bearer token and the active
 * tenant from the keychain + config exactly once per process. After
 * `vskill auth login` mutates the keychain, the same-process cache still
 * holds pre-login state — so a script doing `vskill auth login && vskill
 * orgs list` from a single Node process never sees the new token. The same
 * applies on logout: a stale cache would keep sending the just-revoked
 * token until the process exits.
 *
 * This function is intentionally exported as a non-test primitive so
 * `auth.ts` can call it after `setVskillToken`, `clearVskillToken`, etc.
 * It is internally identical to `_resetClientAuthCacheForTests`; we keep
 * both names so the test hook stays explicit and the production callsite
 * reads correctly.
 */
export function invalidateAuthCache(): void {
  _authCache.token = null;
  _authCache.tenant = null;
  _authCache.loaded = false;
}

/**
 * Resolve the Authorization token to send. Prefers `vsk_*`, falls back to
 * `gho_*`. Returns null when nothing is stored (anonymous mode).
 *
 * Cached for the lifetime of the process so a single command invocation
 * hits the keychain at most once (AC-US1-06).
 */
function resolveAuthToken(): string | null {
  if (_authCache.loaded) return _authCache.token;
  let token: string | null = null;
  try {
    const kc = _keychainOverride ?? getDefaultKeychain();
    // Prefer vsk_* (ADR-001 / AC-US5-04).
    token = kc.getVskillToken() ?? kc.getGitHubToken();
  } catch {
    token = null;
  }
  _authCache.token = token;
  // Tenant resolution: env override beats config file (mirrors ADR-002
  // step #2 — the lib `getActiveTenant` only reads the config file, so we
  // layer the env check here). Per-command --tenant flags are applied by
  // callers via `buildRequestHeaders({ tenantOverride })`.
  let tenant: string | null = null;
  if (process.env.VSKILL_TENANT && process.env.VSKILL_TENANT.length > 0) {
    tenant = process.env.VSKILL_TENANT;
  } else {
    try {
      tenant = getActiveTenant();
    } catch {
      tenant = null;
    }
  }
  _authCache.tenant = tenant;
  _authCache.loaded = true;
  return token;
}

export interface BuildHeadersOptions {
  /** Per-call tenant override (CLI --tenant flag). */
  tenantOverride?: string | null;
}

/**
 * Build the standard request headers for a verified-skill API call:
 *   - Content-Type / User-Agent (always)
 *   - Authorization: Bearer <token> (when a token is stored)
 *   - X-Vskill-Tenant: <slug> (when an active tenant is set or overridden)
 *
 * Callers may pass extra headers via `extra`; those win over defaults.
 */
export function buildRequestHeaders(
  extra?: Record<string, string>,
  opts: BuildHeadersOptions = {},
): Record<string, string> {
  const token = resolveAuthToken();
  const tenant =
    opts.tenantOverride !== undefined ? opts.tenantOverride : _authCache.tenant;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "vskill-cli",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    if (process.env.VSKILL_DEBUG === "1") {
      const kind = token.startsWith("vsk_") ? "vsk_" : "gho_";
      process.stderr.write(`[auth] using ${kind} token (cached)\n`);
    }
  } else if (process.env.VSKILL_DEBUG === "1") {
    process.stderr.write(`[auth] no token, anonymous\n`);
  }
  if (tenant) {
    headers["X-Vskill-Tenant"] = tenant;
    if (process.env.VSKILL_DEBUG === "1") {
      process.stderr.write(`[auth] tenant: ${tenant}\n`);
    }
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers[k] = v;
  }
  return headers;
}
const VERSION: string = (() => {
  try {
    const require = createRequire(import.meta.url);
    return require("../../package.json").version as string;
  } catch {
    return "unknown";
  }
})();

export interface SkillSearchResult {
  name: string;
  author: string;
  repoUrl?: string;
  tier: string;
  score: number;
  description: string;
  installs: number;
  /** GitHub stars (returned by search API) */
  githubStars: number;
  command?: string | null;
  pluginName?: string | null;
  isTainted?: boolean;
  /** Trust tier (T0-T4) */
  trustTier?: "T0" | "T1" | "T2" | "T3" | "T4";
  /** Certification tier */
  certTier?: "CERTIFIED" | "VERIFIED";
  /** True when the skill is on the blocklist (known malicious) */
  isBlocked?: boolean;
  /** Threat classification (e.g. "credential-theft", "prompt-injection") */
  threatType?: string;
  /** Severity level (e.g. "critical", "high") */
  severity?: string;
  /** Install count from the vskill registry */
  vskillInstalls?: number;
  /** GitHub owner slug (e.g., "openclaw") */
  ownerSlug?: string;
  /** GitHub repo slug (e.g., "openclaw") */
  repoSlug?: string;
  /** Skill folder name (e.g., "gog") */
  skillSlug?: string;
  /** Current published version (semver) */
  currentVersion?: string;
  /** Alternate repos containing the same skill from the same org */
  alternateRepos?: Array<{ ownerSlug: string; repoSlug: string; repoUrl: string }>;
}

export interface SkillDetail {
  name: string;
  author: string;
  tier: string;
  score: number;
  version: string;
  sha: string;
  description: string;
  content?: string;
  installs: number;
  updatedAt: string;
  repoUrl?: string;
  /** Trust tier classification (T0-T4) */
  trustTier?: string;
  /** Composite trust score (0-100) */
  trustScore?: number;
  /** Whether author-repo ownership is verified */
  provenanceVerified?: boolean;
  command?: string | null;
  pluginName?: string | null;
}

export interface SubmissionResponse {
  /** Submission ID (present for new + duplicate submissions) */
  id?: string;
  state?: string;
  createdAt?: string;
  /** True when an identical pending submission already exists */
  duplicate?: boolean;
  /** Skill ID (present when skill is already verified) */
  skillId?: string;
  skillName?: string;
  /** True when skill already passed verification */
  alreadyVerified?: boolean;
  /** True when skill/submission is blocked */
  blocked?: boolean;
  submissionId?: string;
}

export interface SubmissionRequest {
  repoUrl: string;
  skillName?: string;
  skillPath?: string;
  email?: string;
  source?: string;
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit & { tenantOverride?: string | null }
): Promise<T> {
  const url = `${resolveBaseUrl()}${path}`;
  const { tenantOverride, ...fetchOpts } = options ?? {};
  const headers = buildRequestHeaders(
    fetchOpts.headers as Record<string, string> | undefined,
    { tenantOverride },
  );
  const res = await fetch(url, {
    ...fetchOpts,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 0839 AC-US1-04 / AC-US1-05 / AC-US2-05: surface auth + entitlement
    // failures as structured errors so callers can format them without
    // sniffing the message string. We attach `.status` and the parsed body
    // (when JSON) to the thrown error.
    const err = new Error(
      `API request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
    ) as Error & {
      status?: number;
      body?: string;
      parsedBody?: unknown;
    };
    err.status = res.status;
    err.body = body;
    if (body) {
      try {
        err.parsedBody = JSON.parse(body);
      } catch {
        /* non-JSON body — leave parsedBody undefined */
      }
    }
    throw err;
  }

  return res.json() as Promise<T>;
}

export interface SearchResponse {
  results: SkillSearchResult[];
  hasMore: boolean;
}

/**
 * Search for skills in the registry.
 * Uses the edge-first search endpoint which is resilient to DB load.
 */
export async function searchSkills(
  query: string,
  options?: { limit?: number },
): Promise<SearchResponse> {
  const encoded = encodeURIComponent(query);
  const limit = options?.limit ?? 7;
  const data = await apiRequest<{
    results: Array<Record<string, unknown>>;
    pagination?: { hasMore?: boolean };
    // Legacy fallback shape
    skills?: Array<Record<string, unknown>>;
  }>(`/api/v1/skills/search?q=${encoded}&limit=${limit}`);
  const items = data.results || data.skills || [];
  const results = items.map((s) => ({
    name: String(s.name || ""),
    author: String(s.author || ""),
    repoUrl: s.repoUrl ? String(s.repoUrl) : undefined,
    tier: String(s.certTier || s.tier || "VERIFIED"),
    score: Number(s.trustScore ?? s.certScore ?? s.score ?? 0),
    description: String(s.description || ""),
    installs: Number(s.vskillInstalls ?? 0),
    githubStars: Number(s.githubStars ?? 0),
    command: s.command ? String(s.command) : null,
    pluginName: s.pluginName ? String(s.pluginName) : null,
    isTainted: !!s.isTainted,
    trustTier: s.trustTier ? String(s.trustTier) as SkillSearchResult["trustTier"] : undefined,
    certTier: s.certTier ? String(s.certTier) as SkillSearchResult["certTier"] : undefined,
    isBlocked: !!s.isBlocked,
    threatType: s.threatType ? String(s.threatType) : undefined,
    severity: s.severity ? String(s.severity) : undefined,
    vskillInstalls: s.vskillInstalls != null ? Number(s.vskillInstalls) : undefined,
    ownerSlug: s.ownerSlug ? String(s.ownerSlug) : undefined,
    repoSlug: s.repoSlug ? String(s.repoSlug) : undefined,
    skillSlug: s.skillSlug ? String(s.skillSlug) : undefined,
    currentVersion: s.currentVersion ? String(s.currentVersion) : undefined,
    alternateRepos: Array.isArray(s.alternateRepos) ? (s.alternateRepos as Array<Record<string, unknown>>).map((a) => ({
      ownerSlug: String(a.ownerSlug || ""),
      repoSlug: String(a.repoSlug || ""),
      repoUrl: String(a.repoUrl || ""),
    })) : undefined,
  }));
  return { results, hasMore: data.pagination?.hasMore ?? false };
}

/**
 * Build an API path for a skill, supporting hierarchical names (owner/repo/skill).
 */
function skillApiPath(name: string): string {
  const parts = name.split("/");
  return parts.length === 3
    ? `/api/v1/skills/${parts.map(encodeURIComponent).join("/")}`
    : `/api/v1/skills/${encodeURIComponent(name)}`;
}

/**
 * Get a single skill by name.
 * Supports both flat ("architect") and hierarchical ("owner/repo/architect") names.
 */
export async function getSkill(name: string): Promise<SkillDetail> {
  const data = await apiRequest<Record<string, unknown>>(skillApiPath(name));

  // API wraps the skill object under a "skill" key
  const raw = (data.skill as Record<string, unknown>) ?? data;

  return {
    name: String(raw.name || ""),
    author: String(raw.author || ""),
    tier: String(raw.certTier || raw.tier || "VERIFIED"),
    score: Number(raw.certScore ?? raw.score ?? 0),
    version: String(raw.currentVersion || raw.version || "0.0.0"),
    sha: String(raw.sha || ""),
    description: String(raw.description || ""),
    content: raw.content ? String(raw.content) : undefined,
    installs: Number(raw.vskillInstalls ?? raw.installs ?? 0),
    updatedAt: String(raw.updatedAt || ""),
    repoUrl: raw.repoUrl ? String(raw.repoUrl) : undefined,
    trustTier: raw.trustTier ? String(raw.trustTier) : undefined,
    trustScore: raw.trustScore != null ? Number(raw.trustScore) : undefined,
    provenanceVerified: raw.provenanceVerified != null ? Boolean(raw.provenanceVerified) : undefined,
    command: raw.command ? String(raw.command) : null,
    pluginName: raw.pluginName ? String(raw.pluginName) : null,
  };
}

/**
 * Submit a skill for verification.
 */
export async function submitSkill(
  data: SubmissionRequest
): Promise<SubmissionResponse> {
  return apiRequest<SubmissionResponse>("/api/v1/submissions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Get the status of a submission.
 */
export async function getSubmission(
  id: string
): Promise<{ id: string; status: string; result?: unknown }> {
  return apiRequest(`/api/v1/submissions/${encodeURIComponent(id)}`);
}

export interface SkillVersionEntry {
  version: string;
  certTier: string;
  createdAt: string;
  contentHash?: string;
  certScore?: number;
  diffSummary?: string | null;
}

/**
 * List published versions for a skill.
 * Supports hierarchical names (owner/repo/skill).
 */
export async function getVersions(
  name: string,
): Promise<SkillVersionEntry[]> {
  const data = await apiRequest<{ versions?: unknown[] }>(
    `${skillApiPath(name)}/versions`,
  );
  const items = Array.isArray(data.versions) ? data.versions : [];
  return items.map((v) => v as Record<string, unknown>).map((v) => ({
    version: String(v.version || ""),
    certTier: String(v.certTier || ""),
    createdAt: String(v.createdAt || ""),
    contentHash: v.contentHash ? String(v.contentHash) : undefined,
    certScore: v.certScore != null ? Number(v.certScore) : undefined,
    diffSummary: v.diffSummary != null ? String(v.diffSummary) : null,
  }));
}

export interface VersionDiffResult {
  from: string;
  to: string;
  diffSummary: string;
  contentDiff: string;
}

/**
 * Get a unified diff between two versions of a skill.
 * Uses the platform `?from=X&to=Y` endpoint.
 */
export async function getVersionDiff(
  name: string,
  from: string,
  to: string,
): Promise<VersionDiffResult> {
  const encoded = [encodeURIComponent(from), encodeURIComponent(to)];
  return apiRequest<VersionDiffResult>(
    `${skillApiPath(name)}/versions/diff?from=${encoded[0]}&to=${encoded[1]}`,
  );
}

/**
 * Report a skill install to the platform with retry.
 * Respects VSKILL_NO_TELEMETRY=1 env var for opt-out.
 * Never throws — all errors are silently swallowed.
 *
 * @param skillName - The skill name to report (e.g., "architect")
 * @param repoUrl - Optional repo URL for fallback matching on the server
 */
export async function reportInstall(
  skillName: string,
  repoUrl?: string,
  version?: string,
): Promise<void> {
  const verbose = process.env.VSKILL_DEBUG === "1";
  try {
    if (process.env.VSKILL_NO_TELEMETRY === "1") return;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
          const res = await fetch(
            `${resolveBaseUrl()}${skillApiPath(skillName)}/installs`,
            {
              method: "POST",
              headers: buildRequestHeaders(),
              body: JSON.stringify({
                ...(repoUrl ? { repoUrl } : {}),
                ...(version ? { version } : {}),
                source: "cli",
                platform: process.platform,
                cliVersion: VERSION,
              }),
              signal: controller.signal,
            },
          );
          if (res.ok) return; // Success — done
          if (verbose) process.stderr.write(`[vskill] install tracking failed: HTTP ${res.status} for ${skillName}\n`);
          // Server error — retry once
          if (attempt === 0 && res.status >= 500) continue;
          return; // Client error or second attempt — give up
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (verbose) process.stderr.write(`[vskill] install tracking error for ${skillName}: ${err}\n`);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue; // Retry after 500ms
        }
      }
    }
  } catch {
    // Silent — install tracking must never block CLI
  }
}

/**
 * Report multiple skill installs in a single batch request.
 * More reliable than individual reportInstall calls for plugin installs.
 * Never throws — all errors are silently swallowed.
 *
 * @param skills - Array of { skillName, repoUrl? } to report
 */
// ---------------------------------------------------------------------------
// Check-updates types
// ---------------------------------------------------------------------------

export interface CheckUpdateItem {
  name: string;
  currentVersion: string;
  sha?: string;
}

export interface CheckUpdateResult {
  name: string;
  installed: string;
  latest: string | null;
  updateAvailable: boolean;
  versionBump?: string;
  diffSummary?: string;
  certTier?: string;
  certScore?: number;
  /** 0740: set when `outdated` could not read the on-disk version and fell
   * back to the lockfile pin. UI surfaces this as a soft hint without
   * breaking the update flow. */
  warning?: string;
}

/**
 * Check multiple installed skills for available updates in a single request.
 * Throws on error — caller is responsible for handling failures.
 */
export async function checkUpdates(
  skills: CheckUpdateItem[],
): Promise<CheckUpdateResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${resolveBaseUrl()}/api/v1/skills/check-updates`, {
      method: "POST",
      headers: buildRequestHeaders(),
      body: JSON.stringify({
        skills,
        platform: process.platform,
        cliVersion: VERSION,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const isJson = body.startsWith("{") || body.startsWith("[");
      const truncated = isJson ? body.slice(0, 200) : `(non-JSON response, ${body.length} bytes)`;
      throw new Error(
        `API request failed: ${res.status} ${res.statusText} - ${truncated}`,
      );
    }
    const data = (await res.json()) as { results: CheckUpdateResult[] };
    return data.results ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Multi-file version compare (0705 / AC-US4-01..AC-US4-06)
// ---------------------------------------------------------------------------

export type CompareFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

export type CompareVersionsResult = {
  source: "github" | "local-content";
  baseSha?: string;
  headSha?: string;
  files: CompareFile[];
  githubCompareUrl?: string;
};

/**
 * Fetch a multi-file diff between two versions of a skill.
 * Hits the platform `/versions/compare?from=X&to=Y` endpoint which returns
 * GitHub-backed compare data when both versions have valid SHAs (source:"github"),
 * or an LCS fallback on SKILL.md alone (source:"local-content").
 */
export async function compareVersions(
  skill: string,
  from: string,
  to: string,
): Promise<CompareVersionsResult> {
  // F-CR-006: encode each path segment separately so skill names containing
  // spaces (` `), `#`, or other reserved characters hit the right endpoint.
  // Whole-string encoding would escape the `/` separators — so we split first,
  // encode per segment, then rejoin on an unencoded `/`.
  const encodedSkill = skill
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = `${resolveBaseUrl()}/api/v1/skills/${encodedSkill}/versions/compare?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    headers: buildRequestHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Compare request failed: ${res.status} ${res.statusText}${body ? ` - ${body.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as CompareVersionsResult;
}

export async function reportInstallBatch(
  skills: Array<{ skillName: string; repoUrl?: string; version?: string }>,
): Promise<void> {
  const verbose = process.env.VSKILL_DEBUG === "1";
  try {
    if (process.env.VSKILL_NO_TELEMETRY === "1") return;
    if (skills.length === 0) return;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
          const res = await fetch(
            `${resolveBaseUrl()}/api/v1/skills/installs`,
            {
              method: "POST",
              headers: buildRequestHeaders(),
              body: JSON.stringify({
                skills,
                source: "cli",
                platform: process.platform,
                cliVersion: VERSION,
              }),
              signal: controller.signal,
            },
          );
          if (res.ok) return;
          if (verbose) process.stderr.write(`[vskill] batch install tracking failed: HTTP ${res.status} for ${skills.length} skills\n`);
          if (attempt === 0 && res.status >= 500) continue;
          return;
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (verbose) process.stderr.write(`[vskill] batch install tracking error: ${err}\n`);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
      }
    }
  } catch {
    // Silent — install tracking must never block CLI
  }
}

// ---------------------------------------------------------------------------
// 0839 — auth + tenant endpoints.
// ---------------------------------------------------------------------------

export interface TenantSummary {
  /** Stable tenant identifier (cuid). */
  tenantId: string;
  /** URL-safe slug used in `X-Vskill-Tenant` and `vskill orgs use`. */
  slug: string;
  /** Human-readable display name (org or user-friendly). */
  name: string;
  /** Caller's role in the tenant (mirror of `OrgMember.role`). */
  role: "owner" | "admin" | "member" | string;
  /** GitHub App installation id, when available. */
  installationId?: string | number | null;
}

export interface ListTenantsResponse {
  tenants: TenantSummary[];
}

/**
 * 0839 US-003 / US-004 — list tenants the authenticated user is a member of.
 * Backed by `GET /api/v1/account/tenants` (added in T-002, ADR-003).
 *
 * Anonymous calls are NOT allowed: when no token is present, the endpoint
 * returns 401 (the platform's `requireUserOrGithubBearer` rejects). Callers
 * that want anonymous-safe behaviour should check for a token first.
 */
export async function listTenants(): Promise<TenantSummary[]> {
  const data = await apiRequest<{
    tenants?: Array<Record<string, unknown>>;
  }>(`/api/v1/account/tenants`);
  const items = Array.isArray(data.tenants) ? data.tenants : [];
  return items.map((t) => ({
    tenantId: String(t.tenantId ?? t.id ?? ""),
    slug: String(t.slug ?? ""),
    name: String(t.name ?? t.slug ?? ""),
    role: String(t.role ?? "member"),
    installationId:
      t.installationId == null
        ? null
        : typeof t.installationId === "number"
          ? t.installationId
          : String(t.installationId),
  }));
}

export interface ExchangeForVskTokenResponse {
  token: string;
  expiresAt: string;
  scopes: string[];
  userId: string;
}

/**
 * 0839 US-005 — exchange a `gho_*` token for a `vsk_*` API token.
 * Hits `POST /api/v1/auth/github/exchange-for-vsk-token`. The response
 * `token` is the plaintext `vsk_*` (returned ONCE — only the hash is
 * persisted server-side per AC-US5-02).
 *
 * Failures throw — callers (auth.ts) decide whether to fall back to
 * "legacy mode" (gho_-only) or surface the error.
 */
export async function exchangeForVskToken(
  githubToken: string,
): Promise<ExchangeForVskTokenResponse> {
  return apiRequest<ExchangeForVskTokenResponse>(
    `/api/v1/auth/github/exchange-for-vsk-token`,
    {
      method: "POST",
      body: JSON.stringify({ githubToken }),
    },
  );
}

/**
 * 0839 US-005 / AC-US5-06 — best-effort server-side revocation. The CLI
 * `auth logout` calls this AFTER clearing the local keychain; failure is
 * logged but never blocks logout.
 */
export async function signOutAll(): Promise<void> {
  await apiRequest<unknown>(`/api/v1/auth/sign-out-all`, { method: "DELETE" });
}

