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
  command?: string | null;
  pluginName?: string | null;
  isTainted?: boolean;
  /** True when the skill is on the blocklist (known malicious) */
  isBlocked?: boolean;
  /** Threat classification (e.g. "credential-theft", "prompt-injection") */
  threatType?: string;
  /** Severity level (e.g. "critical", "high") */
  severity?: string;
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
  id: string;
  status: string;
  trackingUrl: string;
}

export interface SubmissionRequest {
  repoUrl: string;
  skillName?: string;
  email?: string;
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
  const limit = options?.limit ?? 15;
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
    command: s.command ? String(s.command) : null,
    pluginName: s.pluginName ? String(s.pluginName) : null,
    isTainted: !!s.isTainted,
    isBlocked: !!s.isBlocked,
    threatType: s.threatType ? String(s.threatType) : undefined,
    severity: s.severity ? String(s.severity) : undefined,
  }));
  return { results, hasMore: data.pagination?.hasMore ?? false };
}

/**
 * Get a single skill by name.
 */
export async function getSkill(name: string): Promise<SkillDetail> {
  const encoded = encodeURIComponent(name);
  const data = await apiRequest<Record<string, unknown>>(`/api/v1/skills/${encoded}`);

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
            `${BASE_URL}/api/v1/skills/${encodeURIComponent(skillName)}/installs`,
            {
              method: "POST",
              headers: {
                "User-Agent": "vskill-cli",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...(repoUrl ? { repoUrl } : {}),
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
export async function reportInstallBatch(
  skills: Array<{ skillName: string; repoUrl?: string }>,
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
