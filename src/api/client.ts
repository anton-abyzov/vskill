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
 */
export async function searchSkills(
  query: string
): Promise<SkillSearchResult[]> {
  const encoded = encodeURIComponent(query);
  const data = await apiRequest<{ skills: Array<Record<string, unknown>> }>(
    `/api/v1/skills?search=${encoded}`
  );
  return (data.skills || []).map((s) => ({
    name: String(s.name || ""),
    author: String(s.author || ""),
    tier: String(s.certTier || s.tier || "SCANNED"),
    score: Number(s.certScore ?? s.score ?? 0),
    installs: Number(s.vskillInstalls ?? s.installs ?? 0),
    description: String(s.description || ""),
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
