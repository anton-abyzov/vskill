// ---------------------------------------------------------------------------
// HTTP client for verified-skill.com API
// ---------------------------------------------------------------------------

const BASE_URL = "https://verified-skill.com";

export interface SkillSearchResult {
  name: string;
  author: string;
  tier: string;
  score: number;
  installs: number;
  description: string;
  command?: string | null;
  pluginName?: string | null;
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

/**
 * Search for skills in the registry.
 * Uses the edge-first search endpoint which is resilient to DB load.
 */
export async function searchSkills(
  query: string
): Promise<SkillSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const data = await apiRequest<{
    results: Array<Record<string, unknown>>;
    // Legacy fallback shape
    skills?: Array<Record<string, unknown>>;
  }>(`/api/v1/skills/search?q=${encoded}`);
  const items = data.results || data.skills || [];
  return items.map((s) => ({
    name: String(s.name || ""),
    author: String(s.author || ""),
    tier: String(s.certTier || s.tier || "SCANNED"),
    score: Number(s.certScore ?? s.score ?? 0),
    installs: Number(s.vskillInstalls ?? s.installs ?? 0),
    description: String(s.description || ""),
    command: s.command ? String(s.command) : null,
    pluginName: s.pluginName ? String(s.pluginName) : null,
  }));
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
    tier: String(raw.certTier || raw.tier || "SCANNED"),
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
 * Report a skill install to the platform (fire-and-forget).
 * Respects VSKILL_NO_TELEMETRY=1 env var for opt-out.
 * Never throws — all errors are silently swallowed.
 */
export async function reportInstall(skillName: string): Promise<void> {
  try {
    if (process.env.VSKILL_NO_TELEMETRY === "1") return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      await fetch(
        `${BASE_URL}/api/v1/skills/${encodeURIComponent(skillName)}/installs`,
        {
          method: "POST",
          headers: { "User-Agent": "vskill-cli" },
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Silent — install tracking must never block CLI
  }
}
