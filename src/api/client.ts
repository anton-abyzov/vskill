// ---------------------------------------------------------------------------
// HTTP client for verified-skill.com API
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";

const BASE_URL = "https://verified-skill.com";
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

async function apiRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "vskill-cli",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `API request failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`
    );
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
            `${BASE_URL}${skillApiPath(skillName)}/installs`,
            {
              method: "POST",
              headers: {
                "User-Agent": "vskill-cli",
                "Content-Type": "application/json",
              },
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
    const res = await fetch(`${BASE_URL}/api/v1/skills/check-updates`, {
      method: "POST",
      headers: {
        "User-Agent": "vskill-cli",
        "Content-Type": "application/json",
      },
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
            `${BASE_URL}/api/v1/skills/installs`,
            {
              method: "POST",
              headers: {
                "User-Agent": "vskill-cli",
                "Content-Type": "application/json",
              },
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
