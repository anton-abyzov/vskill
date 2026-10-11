// 0850 — client for POST /api/studio/remove-skill.
//
// Mirrors the install-skill client shape: localhost-only on the server side,
// the browser just speaks JSON to the local eval-server.

type FetchLike = typeof fetch;

export interface RemoveSkillRequest {
  skill: string;
  agentIds: string[];
  scope: "project" | "user";
  /** 0894: remove for every agent in the scope — the shared copy, every
   *  agent's own link or copy, and the lockfile entry. */
  all?: boolean;
}

export interface RemoveSkillResponse {
  skill: string;
  scope: "project" | "user";
  removed: Array<{ agentId: string; path: string }>;
  /** sharedWith (0894): the agents that still load the shared copy when the
   *  remove was refused because the skill lives in `.agents/skills`. */
  skipped: Array<{ agentId: string; reason: string; sharedWith?: string[] }>;
  errors:  Array<{ agentId: string; message: string }>;
}

export async function removeSkillFromAgents(
  body: RemoveSkillRequest,
  opts?: { fetchImpl?: FetchLike },
): Promise<RemoveSkillResponse> {
  const f = opts?.fetchImpl ?? fetch;
  const res = await f("/api/studio/remove-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `remove-skill failed: HTTP ${res.status}`);
  }
  return (await res.json()) as RemoveSkillResponse;
}
