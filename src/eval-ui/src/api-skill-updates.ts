// Version history, installed-update requests, and update reconciliation.
import type { SkillInfo, VersionEntry, VersionDiff } from "./types";
import type { SkillVersionsEnvelope } from "./api";
import { resolveSkillVersion } from "./version-resolver.js";

const BASE = "";
type FetchJson = <T>(url: string, init?: RequestInit) => Promise<T>;

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

// 0821: Studio-side batch cap for /api/v1/skills/check-updates. Mirrors the
// platform's MAX_BATCH_SIZE at vskill-platform/src/app/api/v1/skills/
// check-updates/route.ts:139 — sending more than this in one POST returns
// HTTP 400 'Maximum 100 skills per request'. If the platform constant
// changes, update this one in lockstep.
const CHECK_UPDATES_BATCH_SIZE = 100;

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0 || size <= 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// 0821 AC-US3-03: test-only handle so the chunkArray helper can be exercised
// directly for its edge cases (empty / exact / sub-size / N×size / 230). The
// helper itself stays file-internal — this namespace is conventionally for
// tests only and is not part of the public API surface.
export const __test__ = { chunkArray };

export interface SseFrame {
  event: string;
  data: unknown;
}

/** Parse complete SSE frames (`event:` / `data:` blocks split by a blank line). */
export function parseSseFrames(text: string): SseFrame[] {
  const frames: SseFrame[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) continue;
    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      /* keep the raw string */
    }
    frames.push({ event, data });
  }
  return frames;
}

/**
 * Read an SSE response body to the end, calling `onFrame` for each complete
 * frame as it arrives. Returns the raw text read.
 */
export async function readSseStream(res: Response, onFrame: (f: SseFrame) => void): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    parseSseFrames(text).forEach(onFrame);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let all = "";
  let pending = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.value) {
      const text = decoder.decode(chunk.value, { stream: !chunk.done });
      all += text;
      pending += text;
      const lastBreak = Math.max(pending.lastIndexOf("\n\n"), pending.lastIndexOf("\r\n\r\n"));
      if (lastBreak >= 0) {
        parseSseFrames(pending.slice(0, lastBreak)).forEach(onFrame);
        pending = pending.slice(lastBreak).replace(/^(\r?\n)+/, "");
      }
    }
    if (chunk.done) break;
  }
  if (pending.trim()) parseSseFrames(pending).forEach(onFrame);
  return all;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export interface SkillUpdateResult {
  /** True only when the server's `done` frame says status "done". */
  ok: boolean;
  status: number;
  /** Error text for failures; otherwise a short excerpt of the stream. */
  body: string;
  /** Installed version after the run (from `done.version`). */
  version: string | undefined;
  /** "done" | "skipped" | "error" from the `done` frame. */
  outcome?: "done" | "skipped" | "error";
  /** Set when the skill was not updated on purpose (pinned, plugin-owned). */
  skipped?: boolean;
  skipReason?: string;
  pinnedVersion?: string;
  /** True when the CLI found nothing newer. */
  upToDate?: boolean;
  fromVersion?: string;
}

/** Turn the frames of one `/update` stream into a truthful result. */
export function interpretUpdateFrames(
  httpOk: boolean,
  httpStatus: number,
  frames: SseFrame[],
  raw = "",
): SkillUpdateResult {
  const done = [...frames].reverse().find((f) => f.event === "done");
  const doneData = (done?.data ?? {}) as Record<string, unknown>;
  const errFrame = [...frames].reverse().find((f) => f.event === "error");
  const errText =
    str((errFrame?.data as Record<string, unknown> | undefined)?.error) ??
    str(doneData.error) ??
    str(doneData.message);
  const outcome = doneData.status === "done" || doneData.status === "skipped" || doneData.status === "error"
    ? (doneData.status as "done" | "skipped" | "error")
    : undefined;
  const version = str(doneData.version);
  if (!httpOk) {
    return { ok: false, status: httpStatus, body: errText ?? raw.slice(0, 200), version, outcome };
  }
  if (!done) {
    return {
      ok: false,
      status: httpStatus,
      body: errText ?? "The update stream ended before the result arrived.",
      version: undefined,
    };
  }
  if (outcome === "skipped") {
    return {
      ok: false,
      status: httpStatus,
      body: str(doneData.message) ?? "Skipped",
      version,
      outcome,
      skipped: true,
      skipReason: str(doneData.reason),
      pinnedVersion: str(doneData.pinnedVersion),
      fromVersion: str(doneData.fromVersion),
    };
  }
  if (outcome !== "done") {
    return { ok: false, status: httpStatus, body: errText ?? "Update failed", version, outcome: outcome ?? "error" };
  }
  return {
    ok: true,
    status: httpStatus,
    body: "",
    version,
    outcome,
    upToDate: doneData.reason === "up-to-date",
    fromVersion: str(doneData.fromVersion),
  };
}

export type BatchUpdateEvent =
  | { type: "start"; skill: string }
  | { type: "done"; skill: string; version?: string; fromVersion?: string; upToDate?: boolean }
  | { type: "skipped"; skill: string; reason?: string; pinnedVersion?: string; message?: string }
  | { type: "error"; skill: string; error: string };

export interface BatchUpdateSummary {
  updated: number;
  failed: number;
  skipped: number;
  /** True when the stream ended without the final `done` frame. */
  incomplete?: boolean;
}

export function createSkillUpdatesApi(fetchJson: FetchJson) {
  return {
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

  /**
   * 1126 P0-2: batch update over a streamed POST. The old version opened an
   * EventSource GET against this POST-only route (it always failed) and
   * listened for `progress` events the server never sends. This reads the
   * POST response stream and reports each `skill:start` / `skill:done` /
   * `skill:skipped` / `skill:error` event, then resolves with the server's
   * real counts. A 409 (another batch running) or a network error rejects.
   */
  async runBatchUpdate(
    skills: string[],
    opts: { onEvent?: (e: BatchUpdateEvent) => void; signal?: AbortSignal } = {},
  ): Promise<BatchUpdateSummary> {
    const res = await fetch(`${BASE}/api/skills/batch-update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ skills }),
      signal: opts.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `Batch update failed (HTTP ${res.status})`);
    }
    let summary: BatchUpdateSummary | null = null;
    const counts = { updated: 0, failed: 0, skipped: 0 };
    await readSseStream(res, (frame) => {
      const data = (frame.data ?? {}) as Record<string, unknown>;
      const skill = typeof data.skill === "string" ? data.skill : "";
      switch (frame.event) {
        case "skill:start":
          opts.onEvent?.({ type: "start", skill });
          break;
        case "skill:done":
          counts.updated++;
          opts.onEvent?.({
            type: "done",
            skill,
            version: str(data.version),
            fromVersion: str(data.fromVersion),
            upToDate: data.reason === "up-to-date",
          });
          break;
        case "skill:skipped":
          counts.skipped++;
          opts.onEvent?.({
            type: "skipped",
            skill,
            reason: str(data.reason),
            pinnedVersion: str(data.pinnedVersion),
            message: str(data.message),
          });
          break;
        case "skill:error":
          counts.failed++;
          opts.onEvent?.({ type: "error", skill, error: str(data.error) ?? "Update failed" });
          break;
        case "done":
          summary = {
            updated: num(data.updated) ?? counts.updated,
            failed: num(data.failed) ?? counts.failed,
            skipped: num(data.skipped) ?? counts.skipped,
          };
          break;
      }
    });
    // A stream cut before `done` still reports what the rows saw.
    return summary ?? { ...counts, incomplete: true };
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
  ): Promise<SkillUpdateResult> {
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
    // F-010: read SSE frames as they arrive. 1126 P0-1: the route always
    // answers HTTP 200 (it is an SSE stream), so success comes from the
    // `done` frame's status, and failures carry the `error` frame's text.
    const frames: SseFrame[] = [];
    let raw = "";
    if (res.body) {
      raw = await readSseStream(res, (f) => frames.push(f));
    } else {
      raw = await res.text();
      frames.push(...parseSseFrames(raw));
    }
    return interpretUpdateFrames(res.ok, res.status, frames, raw);
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

  /**
   * Installed skills with update info. Most callers (bell, sidebar merge)
   * degrade to `[]` on failure. 1126 P1-6: the Updates view passes
   * `{ throwOnError: true }` so a failed check shows an error with Retry
   * instead of "All skills are up to date".
   */
  async getSkillUpdates(opts: { throwOnError?: boolean } = {}): Promise<SkillUpdateInfo[]> {
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/skills/updates`);
    } catch (err) {
      if (opts.throwOnError) {
        throw new Error(`Couldn't reach Studio: ${err instanceof Error ? err.message : String(err)}`);
      }
      return [];
    }
    if (!res.ok) {
      if (!opts.throwOnError) return [];
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `Couldn't check for updates (HTTP ${res.status})`);
    }
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) return data as SkillUpdateInfo[];
    if (opts.throwOnError) throw new Error("Couldn't check for updates: unexpected response");
    return [];
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
    //
    // 0821: chunk into ≤CHECK_UPDATES_BATCH_SIZE per request. Studios with
    // >100 installed skills previously hit the platform's MAX_BATCH_SIZE cap
    // and got HTTP 400 'Maximum 100 skills per request', silently degrading
    // the not-tracked dot (AC-US5-09). Chunks fire concurrently via
    // Promise.all; each chunk's failure degrades only that chunk (returns
    // [] for it) so siblings still contribute.
    const sortedIds = [...skillIds].sort();
    const chunks = chunkArray(sortedIds, CHECK_UPDATES_BATCH_SIZE);

    type Row = {
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
    };

    const fetchChunk = async (chunk: string[]): Promise<Row[]> => {
      try {
        const res = await fetchWith5xxRetry(`${BASE}/api/v1/skills/check-updates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skills: chunk.map((name) => ({ name, currentVersion: "0.0.0" })),
          }),
        });
        if (!res.ok) return [];
        const body = await res.json().catch(() => null);
        // 0708 wrap-up: accept both the flat-array shape (legacy reconcile
        // contract) AND the `{results: [...]}` envelope used by the platform's
        // POST /skills/check-updates handler. The latter carries the
        // `trackedForUpdates` flag that drives AC-US5-09.
        if (Array.isArray(body)) return body as Row[];
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
            // 0806: drop the "0.0.0" placeholder we sent so it can't round-trip
            // back as if it were a real installed version. Without this filter,
            // mergeUpdatesIntoSkills overwrites the lockfile-stamped
            // currentVersion with "0.0.0" → resolveSkillVersion rejects the
            // sentinel → falls through to versionSource="frontmatter" → badge
            // loses its italic/registry styling within seconds of first paint.
            installed: typeof r.installed === "string" && r.installed !== "0.0.0" ? r.installed : undefined,
            latest: typeof r.latest === "string" ? r.latest : undefined,
            name: typeof r.name === "string" ? r.name : undefined,
          }));
        }
        return [];
      } catch (err) {
        const SKILL_UPDATE_DEBUG = false;
        if (SKILL_UPDATE_DEBUG) {
          // eslint-disable-next-line no-console
          console.warn("[studio] checkSkillUpdates chunk failed:", err instanceof Error ? err.message : String(err));
        }
        return [];
      }
    };

    const chunkResults = await Promise.all(chunks.map(fetchChunk));
    return chunkResults.flat();
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
    // 0821: chunk into ≤CHECK_UPDATES_BATCH_SIZE per request to stay under the
    // platform's MAX_BATCH_SIZE cap. Per-chunk failures degrade only that
    // chunk's entries (no uuid/slug); successful chunks still enrich.
    const chunks = chunkArray(skills, CHECK_UPDATES_BATCH_SIZE);

    // Each chunk reports its own ok/empty state. We use that to decide whether
    // to preserve the F-006 (0736) "all-failed" diagnostic contract: when every
    // chunk fails, the function throws so StudioContext.tsx:491 can emit a
    // once-per-session console.warn and reset its retry signature.
    const fetchChunk = async (
      chunk: typeof skills,
    ): Promise<{ ok: boolean; map: Map<string, Record<string, unknown>> }> => {
      try {
        const res = await fetchWith5xxRetry(`${BASE}/api/v1/skills/check-updates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            skills: chunk.map((s) => ({
              name: s.name,
              currentVersion: s.currentVersion ?? "0.0.0",
            })),
          }),
        });
        if (!res.ok) return { ok: false, map: new Map() };
        const body = await res.json().catch(() => null);
        const results: Array<Record<string, unknown>> = Array.isArray(body)
          ? body
          : Array.isArray((body as { results?: unknown[] } | null)?.results)
            ? (body as { results: Array<Record<string, unknown>> }).results
            : [];
        return {
          ok: true,
          map: new Map(
            results
              .filter((r) => typeof r.name === "string" && (r.name as string).length > 0)
              .map((r) => [r.name as string, r]),
          ),
        };
      } catch {
        return { ok: false, map: new Map() };
      }
    };

    // Per-chunk graceful degradation (AC-US2-03): a single failing chunk
    // produces empty enrichment for its entries; sibling chunks still merge.
    // F-006 (0736) all-fail contract: if EVERY chunk fails, throw so the
    // StudioContext .catch() block emits a once-per-session diagnostic warn
    // and resets lastResolveSigRef for retry on the next poll cycle.
    const chunkResults = await Promise.all(chunks.map(fetchChunk));
    if (chunkResults.length > 0 && chunkResults.every((c) => !c.ok)) {
      throw new Error("resolveInstalledSkillIds: all chunks failed");
    }
    const byName = new Map<string, Record<string, unknown>>();
    for (const c of chunkResults) {
      for (const [k, v] of c.map) byName.set(k, v);
    }
    return skills.map((s) => {
      const r = byName.get(s.name);
      return {
        plugin: s.plugin,
        skill: s.skill,
        uuid: typeof r?.id === "string" && r.id.length > 0 ? r.id : undefined,
        slug: typeof r?.slug === "string" && r.slug.length > 0 ? r.slug : undefined,
      };
    });
  },

  };
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
    // 0806: defence-in-depth — if the polling source somehow leaks the "0.0.0"
    // placeholder (e.g. a check-updates round-trip path that sneaks past the
    // boundary filter, or an upstream regression), keep the row's existing
    // server-stamped currentVersion instead of clobbering it. The same
    // sentinel is also rejected by resolveSkillVersion's `pick()` later, but
    // dropping it here preserves the lockfile-pinned value end-to-end so the
    // badge keeps its italic/registry styling stable.
    const installedFromUpdate = u.installed && u.installed !== "0.0.0" ? u.installed : null;
    const merged: SkillInfo = {
      ...s,
      updateAvailable,
      currentVersion: installedFromUpdate ?? s.currentVersion,
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
