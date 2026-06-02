// 0845 — install API helpers for the cross-tool install flow.
//
// Two endpoints used by the InstallTargetsModal + AgentScopePicker:
//   - GET  /api/studio/supported-agents    → fetchSupportedAgents()
//   - POST /api/studio/install-skill       → installToAgents() (multi-agent)
//                                            startInstallStream() (SSE consumer)
//
// All calls go to localhost only — the eval-server enforces the localhost
// guard, and the browser side talks to the local dev server (no CORS, no
// external API calls — see project memory project_studio_cors_free_architecture.md).

import type {
  AgentInstallResult,
  MultiInstallResult,
  SupportedAgent,
  SupportedAgentsResponse,
} from "../types";
import { openFetchEventStream, type FetchEventStreamHandle } from "./sse";

type FetchLike = typeof fetch;

interface IoOptions {
  fetchImpl?: FetchLike;
}

function resolveFetch(opts?: IoOptions): FetchLike {
  return opts?.fetchImpl ?? fetch;
}

/**
 * Fetch the full set of agents the Studio knows how to install to —
 * Tier 1/2 (filesystem) + Tier 3 (clipboard). Detection is bounded
 * server-side; undetected agents still come back with `detected: false`.
 */
export async function fetchSupportedAgents(
  opts?: IoOptions,
): Promise<SupportedAgent[]> {
  const f = resolveFetch(opts);
  const res = await f("/api/studio/supported-agents", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`fetchSupportedAgents failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as SupportedAgentsResponse;
  return Array.isArray(body?.agents) ? body.agents : [];
}

export interface InstallToAgentsRequest {
  skill: string;
  agentIds: string[];
  scope: "project" | "user" | "global";
}

export interface InstallToAgentsHandle {
  jobId: string;
  streamPath?: string;
  mode?: string;
}

/**
 * Kick off a multi-agent install. Returns the SSE jobId so callers can
 * open the per-agent progress stream via {@link startInstallStream}.
 *
 * Backward compat: the legacy single-agent path (`{ skill, agent, scope }`)
 * still works on the server — this helper is for the new `agentIds[]` shape
 * only.
 */
export async function installToAgents(
  body: InstallToAgentsRequest,
  opts?: IoOptions,
): Promise<InstallToAgentsHandle> {
  const f = resolveFetch(opts);
  const res = await f("/api/studio/install-skill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `install-skill failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    jobId?: string;
    streamPath?: string;
    mode?: string;
  };
  if (!json.jobId) {
    throw new Error("install-skill: server did not return a jobId");
  }
  return {
    jobId: json.jobId,
    ...(typeof json.streamPath === "string" && json.streamPath.startsWith("/")
      ? { streamPath: json.streamPath }
      : {}),
    ...(typeof json.mode === "string" ? { mode: json.mode } : {}),
  };
}

export interface InstallStreamCallbacks {
  onResult: (result: AgentInstallResult) => void;
  onDone: (summary: MultiInstallResult) => void;
  onError?: (err: Error) => void;
}

export interface InstallStreamHandle {
  close: () => void;
}

/**
 * Subscribe to the SSE progress stream for a given install job.
 * Emits one `result` event per agent followed by a terminal `done`
 * event carrying the full summary.
 */
export function startInstallStream(
  jobIdOrStreamPath: string,
  callbacks: InstallStreamCallbacks,
  opts?: IoOptions,
): InstallStreamHandle {
  const f = resolveFetch(opts);
  const streamUrl = jobIdOrStreamPath.startsWith("/")
    ? jobIdOrStreamPath
    : `/api/studio/install-skill/${encodeURIComponent(jobIdOrStreamPath)}/stream`;
  let stream: FetchEventStreamHandle;
  stream = openFetchEventStream(streamUrl, {
    fetchImpl: f,
    timeoutMessage: "install-skill SSE stream timed out",
    onEvent: ({ event, data: rawData }) => {
      if (event === "result") {
        try {
          const data = JSON.parse(rawData) as AgentInstallResult;
          callbacks.onResult(data);
        } catch (err) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      }

      if (event === "done") {
        let summary: MultiInstallResult = { results: [] };
        try {
          summary = JSON.parse(rawData) as MultiInstallResult;
        } catch {
          // ignore parse error — emit empty summary
        }
        stream.close();
        callbacks.onDone(summary);
      }
    },
    onError: (err) => callbacks.onError?.(err),
  });

  return stream;
}

// ---------------------------------------------------------------------------
// Group helpers — shared by AgentScopePicker.Popover (3-section view) and
// InstallTargetsModal (tier-grouped checkbox list). Keeping the grouping
// logic in one place ensures both views agree on which row goes where.
// ---------------------------------------------------------------------------

export interface SupportedAgentsBySection {
  detected: SupportedAgent[];
  available: SupportedAgent[];
  cloud: SupportedAgent[];
}

export interface SupportedAgentsByTier {
  dropIn: SupportedAgent[];
  formatConverted: SupportedAgent[];
  cloud: SupportedAgent[];
}

/**
 * Section split used by the AgentScopePicker popover when `groupBy="installMode"`.
 *   detected:   installMode==="filesystem" AND detected===true
 *   available:  installMode==="filesystem" AND detected===false
 *   cloud:      installMode==="clipboard"  (always — by definition undetectable)
 */
export function groupSupportedAgentsBySection(
  agents: SupportedAgent[],
): SupportedAgentsBySection {
  const detected: SupportedAgent[] = [];
  const available: SupportedAgent[] = [];
  const cloud: SupportedAgent[] = [];
  for (const a of agents) {
    if (a.installMode === "clipboard") {
      cloud.push(a);
    } else if (a.detected) {
      detected.push(a);
    } else {
      available.push(a);
    }
  }
  const byName = (x: SupportedAgent, y: SupportedAgent) =>
    x.displayName.localeCompare(y.displayName);
  return {
    detected: detected.sort(byName),
    available: available.sort(byName),
    cloud: cloud.sort(byName),
  };
}

/**
 * Tier split used by the InstallTargetsModal — detected sorts above
 * undetected within each tier group (AC-US2-02).
 */
export function groupSupportedAgentsByTier(
  agents: SupportedAgent[],
): SupportedAgentsByTier {
  const dropIn: SupportedAgent[] = [];
  const formatConverted: SupportedAgent[] = [];
  const cloud: SupportedAgent[] = [];
  for (const a of agents) {
    if (a.tier === 1 && a.installMode === "filesystem") {
      dropIn.push(a);
    } else if (a.tier === 2 && a.installMode === "filesystem") {
      formatConverted.push(a);
    } else if (a.tier === 3 || a.installMode === "clipboard") {
      cloud.push(a);
    } else {
      // Defensive default: anything tier=1 but with unknown installMode
      // lands in dropIn. (Should not happen — server validates the shape.)
      dropIn.push(a);
    }
  }
  const sortDetectedFirst = (x: SupportedAgent, y: SupportedAgent) => {
    if (x.detected !== y.detected) return x.detected ? -1 : 1;
    return x.displayName.localeCompare(y.displayName);
  };
  return {
    dropIn: dropIn.sort(sortDetectedFirst),
    formatConverted: formatConverted.sort(sortDetectedFirst),
    cloud: cloud.sort(sortDetectedFirst),
  };
}
