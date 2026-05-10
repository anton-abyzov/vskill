import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api";
import type { SkillUpdateInfo } from "../api";
import type { SkillUpdateEvent, StreamStatus, UpdateStoreEntry } from "../types/skill-update";
import { updateStore } from "../stores/updateStore";
import {
  enqueue as enqueueToast,
  drain as drainToastQueue,
  type QueuedToast,
} from "../utils/toastQueue";

/**
 * Shared update hook — polling (0683) + SSE push (0708).
 *
 * Responsibilities:
 *   - Polling path (0683): `updates`, `updatesMap` (keyed by canonical full
 *     name, with leaf alias when unambiguous — see `buildMap`), `updateCount`,
 *     `refresh`, `lastFetchAt`, `error`. Preserves the exact public contract
 *     that UpdateBell, SidebarSection, UpdateToast, and
 *     StudioContext.mergeUpdatesIntoSkills consume.
 *   - SSE push (0708): when `skillIds` is non-empty, opens a single
 *     EventSource against `/api/v1/skills/stream?skills=<sorted-csv>`. The
 *     filter is scoped to installed skills (AC-US5-08). Events land in the
 *     shared `updateStore` (see stores/updateStore.ts), dedup'd via a
 *     500-capacity FIFO `seenEventIds` Set with `seenLastId` persisted to
 *     localStorage for `Last-Event-ID` replay (AC-US5-10). When the stream
 *     disconnects for >60 s the hook flips `status: "fallback"` and the
 *     existing 5-min polling cadence handles reconciliation (AC-US5-05); a
 *     successful reconnect returns `status: "connected"`. An `event: gone`
 *     frame clears `seenEventIds`, issues a silent one-shot
 *     `/api/v1/skills/check-updates` reconciliation, and merges the result
 *     (AC-US5-11) — no toast fires.
 *   - 0838 visibility queue (US-003): when an event arrives while the tab is
 *     hidden, the toast payload is enqueued to a bounded localStorage FIFO
 *     instead of dispatching `studio:toast`. On the next visibilitychange →
 *     "visible" the queue is drained at 250 ms intervals, deduped against
 *     `updateStore.seenEventIds`.
 *   - 0838 debug flag (US-001): `[sse]` console.debug logging gated on
 *     `import.meta.env.VITE_VSKILL_DEBUG_SSE` or `?debugSse=1` query param.
 *   - 0838 telemetry (US-005): once-per-(event, session) POST to
 *     `/api/v1/studio/telemetry/sse` on stream lifecycle transitions.
 *     Disabled by `VITE_VSKILL_DISABLE_TELEMETRY` or `?disableTelemetry=1`.
 *
 * SSE ID-format contract (0736 / AC-US3-01)
 * ------------------------------------------
 * UpdateHub (vskill-platform) accepts ONLY UUID (`Skill.id`) or public slug
 * (`sk_published_<owner>/<repo>/<skill>`) in the `?skills=<csv>` filter.
 * The raw `<plugin>/<skill>` local name (e.g. `.claude/greet-anton`) is
 * silently dropped by the platform and must NOT appear in the filter.
 */

// ---------------------------------------------------------------------------
// Options / public return shape
// ---------------------------------------------------------------------------

export interface UseSkillUpdatesOptions {
  /** Polling interval in ms (5 min by default). */
  intervalMs?: number;
  debounceMs?: number;
  timeoutMs?: number;
  staleAfterMs?: number;
  /**
   * 0708: Installed skill IDs the current user's Studio should subscribe to.
   */
  skillIds?: string[];
  /**
   * 0708 wrap-up: skill IDs to query for tracking state (`trackedForUpdates`).
   */
  trackingSkillIds?: string[];
  /**
   * 0708 fallback watchdog — how long to wait for a sustained `connected`
   * signal before flipping `status: "fallback"`. Defaults to 60 s per AC-US5-05.
   */
  disconnectFallbackMs?: number;
  /** 0708: Override `/api/v1/skills/stream` path (test injection only). */
  streamUrlBase?: string;
  /**
   * 0838: replay-spacing override (ms between queued-toast dispatches on
   * visibility flip). Defaults to 250 ms per AC-US3-03.
   */
  replayIntervalMs?: number;
}

export interface SkillUpdatesState {
  /** Polling (0683) payload list. */
  updates: SkillUpdateInfo[];
  /** Polling (0683) map keyed by skill SHORT name. */
  updatesMap: Map<string, SkillUpdateInfo>;
  /** Polling (0683) outdated count. */
  updateCount: number;
  isRefreshing: boolean;
  lastFetchAt: number | null;
  error: Error | null;

  /** 0708 SSE: keyed-by-skillId store snapshot. */
  updatesById: ReadonlyMap<string, UpdateStoreEntry>;
  /** 0708 SSE: count of entries in the push store. */
  pushUpdateCount: number;
  /** 0708 SSE: `"connecting" | "connected" | "fallback"` — AC-US5-01. */
  status: StreamStatus;
}

export interface UseSkillUpdatesReturn extends SkillUpdatesState {
  refresh: () => Promise<void>;
  /** 0708 SSE: dismiss an entry from the push store (e.g. after install). */
  dismiss: (skillId: string) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL = 300_000; // 5 min
const DEFAULT_DEBOUNCE = 500;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_STALE = 60_000;
const DEFAULT_FALLBACK_MS = 60_000;
const DEFAULT_STREAM_BASE = "/api/v1/skills/stream";
const DEFAULT_REPLAY_INTERVAL_MS = 250;
const TELEMETRY_ENDPOINT = "/api/v1/studio/telemetry/sse";
const SESSION_ID_KEY = "vskill.studio.sse.sessionId";

// ---------------------------------------------------------------------------
// 0838 helpers — debug, telemetry, sessionId
// ---------------------------------------------------------------------------

function readImportMetaEnv(): Record<string, string | undefined> {
  // Wrapped so jsdom-mode tests (no Vite env injection) still work.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    if (env && typeof env === "object") return env;
  } catch {
    // ignore
  }
  return {};
}

function isDebugSse(): boolean {
  if (typeof window === "undefined") return false;
  const env = readImportMetaEnv();
  if (env.VITE_VSKILL_DEBUG_SSE === "1" || env.VITE_VSKILL_DEBUG_SSE === "true") {
    return true;
  }
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("debugSse") === "1") return true;
  } catch {
    // ignore
  }
  return false;
}

function isTelemetryDisabled(): boolean {
  if (typeof window === "undefined") return true;
  const env = readImportMetaEnv();
  if (env.VITE_VSKILL_DISABLE_TELEMETRY === "1" || env.VITE_VSKILL_DISABLE_TELEMETRY === "true") {
    return true;
  }
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("disableTelemetry") === "1") return true;
  } catch {
    // ignore
  }
  return false;
}

function debugSse(event: string, payload?: Record<string, unknown>): void {
  if (!isDebugSse()) return;
  try {
    const ts = new Date().toISOString();
    if (payload) {
      // eslint-disable-next-line no-console
      console.debug(`[sse] ${ts} ${event}`, payload);
    } else {
      // eslint-disable-next-line no-console
      console.debug(`[sse] ${ts} ${event}`);
    }
  } catch {
    // ignore
  }
}

function uuidV4(): string {
  // crypto.randomUUID() is the canonical path; fall back to a hand-rolled
  // v4 for jsdom environments that lack it.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // ignore
    }
  }
  // RFC 4122 v4 hand-rolled.
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(Math.floor(Math.random() * 256).toString(16).padStart(2, "0"));
  }
  hex[6] = ((parseInt(hex[6], 16) & 0x0f) | 0x40).toString(16).padStart(2, "0");
  hex[8] = ((parseInt(hex[8], 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = uuidV4();
    window.sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return uuidV4();
  }
}

// ---------------------------------------------------------------------------
// Existing helpers
// ---------------------------------------------------------------------------

function buildMap(list: SkillUpdateInfo[]): Map<string, SkillUpdateInfo> {
  const out = new Map<string, SkillUpdateInfo>();
  for (const u of list) out.set(u.name, u);
  const leafCounts = new Map<string, number>();
  for (const u of list) {
    const leaf = u.name.split("/").pop() || u.name;
    if (leaf === u.name) continue;
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
  }
  for (const u of list) {
    const leaf = u.name.split("/").pop() || u.name;
    if (leaf === u.name) continue;
    if ((leafCounts.get(leaf) ?? 0) > 1) continue;
    if (!out.has(leaf)) out.set(leaf, u);
  }
  return out;
}

function countOutdated(list: SkillUpdateInfo[]): number {
  let n = 0;
  for (const u of list) if (u.updateAvailable) n++;
  return n;
}

function isSkillUpdateEvent(v: unknown): v is SkillUpdateEvent {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.type === "skill.updated" &&
    typeof r.eventId === "string" &&
    typeof r.skillId === "string" &&
    typeof r.version === "string"
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSkillUpdates(
  opts?: UseSkillUpdatesOptions,
): UseSkillUpdatesReturn {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL;
  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT;
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE;
  const fallbackMs = opts?.disconnectFallbackMs ?? DEFAULT_FALLBACK_MS;
  const streamBase = opts?.streamUrlBase ?? DEFAULT_STREAM_BASE;
  const replayIntervalMs = opts?.replayIntervalMs ?? DEFAULT_REPLAY_INTERVAL_MS;

  // Sort-stable CSV so url identity is deterministic.
  const skillsCsv = useMemo(() => {
    if (!opts?.skillIds || opts.skillIds.length === 0) return "";
    return [...opts.skillIds].sort().join(",");
  }, [opts?.skillIds]);

  // Wider list for tracking-state reconciliation (AC-US5-09).
  const trackingCsv = useMemo(() => {
    const list = opts?.trackingSkillIds ?? opts?.skillIds ?? [];
    if (list.length === 0) return "";
    return [...list].sort().join(",");
  }, [opts?.trackingSkillIds, opts?.skillIds]);

  // ----- Polling state (0683 — unchanged semantics) ------------------------
  const [updates, setUpdates] = useState<SkillUpdateInfo[]>([]);
  const [updatesMap, setUpdatesMap] = useState<Map<string, SkillUpdateInfo>>(() => new Map());
  const [updateCount, setUpdateCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // ----- SSE state (0708) --------------------------------------------------
  const [status, setStatus] = useState<StreamStatus>(() =>
    skillsCsv ? "connecting" : "fallback",
  );
  const statusRef = useRef(status);
  statusRef.current = status;

  // 0838: per-session telemetry dedupe — Set keyed by event name.
  const telemetrySentRef = useRef<Set<string>>(new Set());
  // 0838: timestamp of the most recent `connected` event (for
  // durationSinceOpenMs in subsequent transitions).
  const lastConnectedAtRef = useRef<number | null>(null);

  // External-store snapshot for the push-driven map.
  const updatesById = useSyncExternalStore(
    (l) => updateStore.subscribe(l),
    () => updateStore.getSnapshot(),
    () => updateStore.getSnapshot(),
  );
  const pushUpdateCount = updatesById.size;

  // ---------------------------------------------------------------------------
  // 0838 telemetry helper (T-012)
  // ---------------------------------------------------------------------------
  const emitTelemetry = useCallback(
    (event: "connected" | "fallback" | "reconnect-scheduled" | "gone-frame-received") => {
      if (isTelemetryDisabled()) return;
      if (telemetrySentRef.current.has(event)) return;
      telemetrySentRef.current.add(event);
      const sessionId = getOrCreateSessionId();
      const now = Date.now();
      const payload: Record<string, unknown> = {
        event,
        sessionId,
        sourceTier: "platform-proxy",
        timestamp: now,
      };
      if (event !== "connected" && lastConnectedAtRef.current != null) {
        payload.durationSinceOpenMs = now - lastConnectedAtRef.current;
      }
      try {
        // Fire-and-forget; never block the SSE path on telemetry.
        void fetch(TELEMETRY_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          // keepalive lets the request survive a navigation; harmless when not.
          keepalive: true,
        }).catch(() => {
          // Swallow — telemetry must never surface errors.
        });
      } catch {
        // Swallow — even sync errors (e.g. fetch is undefined) are non-fatal.
      }
    },
    [],
  );

  // ----- Polling mechanics (unchanged) -------------------------------------
  const doFetch = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const raced = await Promise.race<SkillUpdateInfo[] | "TIMEOUT">([
        api.getSkillUpdates(),
        new Promise<"TIMEOUT">((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new Error("TIMEOUT"));
          });
        }),
      ]);
      if (raced === "TIMEOUT") throw new Error("TIMEOUT");
      if (!mountedRef.current) return;
      setUpdates(raced);
      setUpdatesMap(buildMap(raced));
      setUpdateCount(countOutdated(raced));
      lastFetchRef.current = Date.now();
      setLastFetchAt(lastFetchRef.current);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      clearTimeout(watchdog);
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [timeoutMs]);

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;
    const p = doFetch().finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = p;
    return p;
  }, [doFetch]);

  const startInterval = useCallback(() => {
    if (intervalRef.current != null) return;
    intervalRef.current = setInterval(() => {
      void refresh();
    }, intervalMs);
  }, [intervalMs, refresh]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // 0838 visibility queue replay (T-006)
  // ---------------------------------------------------------------------------
  const replayQueue = useCallback(() => {
    if (typeof window === "undefined") return;
    const drained = drainToastQueue();
    if (drained.length === 0) return;
    debugSse("queue-drain", { count: drained.length });
    // 0838 AC-US3-05: dedupe against the store entry currently keyed by
    // skillId. If the entry has been *replaced* (different eventId — e.g.
    // the polling fallback discovered a newer publish during the hidden
    // window), we suppress the now-stale queued toast. If the entry still
    // matches the queued eventId, we emit — that's the primary purpose of
    // the queue. If the entry was cleared (e.g. user dismissed), we still
    // emit — the user opted out of seeing the live indicator, but the
    // queued toast represents an arrival they couldn't perceive.
    drained.forEach((entry, idx) => {
      const dispatchOne = () => {
        if (!mountedRef.current) return;
        const storeEntry = updateStore.getSnapshot().get(entry.skillId);
        if (storeEntry && storeEntry.eventId !== entry.eventId) {
          // A newer event for this skill has replaced ours — skip.
          debugSse("queue-replay-skip-superseded", {
            queuedEventId: entry.eventId,
            currentEventId: storeEntry.eventId,
          });
          return;
        }
        try {
          window.dispatchEvent(
            new CustomEvent("studio:toast", {
              detail: {
                message: entry.message,
                severity: entry.severity,
                skillId: entry.skillId,
                version: entry.version,
                eventId: entry.eventId,
              },
            }),
          );
          debugSse("queue-replay", { eventId: entry.eventId });
        } catch {
          // ignore — dispatch failures are non-fatal
        }
      };
      // First entry fires on the next tick; subsequent entries spaced by
      // replayIntervalMs (AC-US3-03).
      setTimeout(dispatchOne, idx * replayIntervalMs);
    });
  }, [replayIntervalMs]);

  useEffect(() => {
    mountedRef.current = true;
    const needsInitial =
      lastFetchRef.current == null ||
      Date.now() - lastFetchRef.current > staleAfterMs;
    if (needsInitial) void refresh();

    const isVisible =
      typeof document === "undefined" || document.visibilityState !== "hidden";
    if (isVisible) startInterval();

    const onVis = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (document.visibilityState === "hidden") {
        stopInterval();
        return;
      }
      // 0838: visible again — replay queued toasts (best-effort, parallel
      // to the polling debounce). Drain happens immediately so subsequent
      // dispatches are spaced by replayIntervalMs.
      replayQueue();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const stale =
          lastFetchRef.current == null ||
          Date.now() - lastFetchRef.current > staleAfterMs;
        if (stale) void refresh();
        startInterval();
      }, debounceMs);
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      mountedRef.current = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      stopInterval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- SSE lifecycle (0708) ---------------------------------------------

  const reconcileCheckUpdates = useCallback(async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      const rows = await api.checkSkillUpdates(ids);
      if (!mountedRef.current || rows.length === 0) return;
      const now = Date.now();
      const pushEntries: UpdateStoreEntry[] = rows
        .filter((r) => r.skillId && r.eventId && r.version)
        .map((r) => ({
          skillId: r.skillId,
          version: r.version,
          eventId: r.eventId,
          publishedAt: r.publishedAt,
          diffSummary: r.diffSummary,
          receivedAt: now,
        }));
      if (pushEntries.length > 0) updateStore.mergeBulk(pushEntries);
      const pollEntries: SkillUpdateInfo[] = rows
        .filter((r) =>
          typeof r.trackedForUpdates === "boolean" ||
          typeof r.updateAvailable === "boolean",
        )
        .map((r) => ({
          name: r.name ?? r.skillId,
          installed: r.installed ?? "",
          latest: r.latest ?? null,
          updateAvailable: r.updateAvailable ?? false,
          trackedForUpdates:
            typeof r.trackedForUpdates === "boolean" ? r.trackedForUpdates : undefined,
        }));
      if (pollEntries.length > 0) {
        setUpdates((prev) => {
          const map = new Map<string, SkillUpdateInfo>();
          for (const u of prev) map.set(u.name, u);
          let added = 0;
          for (const u of pollEntries) {
            const key = u.name;
            const existing = map.get(key);
            if (existing) {
              const enriched: SkillUpdateInfo = { ...existing };
              if (existing.trackedForUpdates === undefined && u.trackedForUpdates !== undefined) {
                enriched.trackedForUpdates = u.trackedForUpdates;
              }
              map.set(key, enriched);
            } else {
              map.set(key, {
                name: u.name,
                installed: u.installed ?? "",
                latest: u.latest ?? null,
                updateAvailable: u.updateAvailable ?? false,
                trackedForUpdates: u.trackedForUpdates,
              });
              added += 1;
            }
          }
          if (added === 0 && map.size === prev.length) {
            return prev;
          }
          const next = [...map.values()];
          setUpdatesMap(buildMap(next));
          setUpdateCount(countOutdated(next));
          return next;
        });
      }
    } catch {
      // Silent — reconciliation failures do not raise visible errors.
    }
  }, []);

  useEffect(() => {
    const csvForSubscribe = skillsCsv || trackingCsv;
    if (!csvForSubscribe) {
      setStatus("fallback");
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus("fallback");
      return;
    }

    setStatus("connecting");
    const ids = csvForSubscribe.split(",");
    const url = `${streamBase}?skills=${encodeURIComponent(csvForSubscribe)}`;
    let es: EventSource | null = null;

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const armFallback = () => {
      if (fallbackTimer != null) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!mountedRef.current) return;
        if (statusRef.current !== "connected") {
          setStatus("fallback");
          debugSse("fallback-flipped", { reason: "watchdog-timeout" });
          emitTelemetry("fallback");
        }
      }, fallbackMs);
      debugSse("fallback-armed", { fallbackMs });
    };
    const cancelFallback = () => {
      if (fallbackTimer != null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };
    armFallback();

    const RECONNECT_BACKOFF_MS = 1_000;
    const scheduleReconnect = () => {
      if (!mountedRef.current) return;
      if (reconnectTimer != null) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (!mountedRef.current) return;
        if (es && es.readyState !== EventSource.CLOSED) return;
        if (es) {
          try { es.close(); } catch { /* noop */ }
        }
        debugSse("reconnect-scheduled", { backoffMs: RECONNECT_BACKOFF_MS });
        emitTelemetry("reconnect-scheduled");
        openStream();
      }, RECONNECT_BACKOFF_MS);
    };

    const onMessage = (evt: MessageEvent) => {
      if (!mountedRef.current) return;
      let payload: unknown;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (!isSkillUpdateEvent(payload)) return;
      const outcome = updateStore.ingest(payload);
      debugSse("message", { eventId: payload.eventId, skillId: payload.skillId, outcome });
      if (outcome === "duplicate") return;
      const isVisible =
        typeof document === "undefined" ||
        document.visibilityState !== "hidden";
      const msg = `${payload.skillId} updated to ${payload.version}`;
      if (isVisible) {
        try {
          window.dispatchEvent(
            new CustomEvent("studio:toast", {
              detail: {
                message: msg,
                severity: "info",
                skillId: payload.skillId,
                version: payload.version,
                eventId: payload.eventId,
              },
            }),
          );
        } catch {
          // ignore
        }
      } else {
        // 0838 AC-US3-01: tab is hidden — enqueue instead of dispatch.
        const queued: QueuedToast = {
          message: msg,
          severity: "info",
          skillId: payload.skillId,
          version: payload.version,
          eventId: payload.eventId,
          enqueuedAt: Date.now(),
        };
        const outcome = enqueueToast(queued);
        debugSse("queue-enqueue", { eventId: payload.eventId, outcome });
      }
    };

    const onGone = () => {
      if (!mountedRef.current) return;
      debugSse("gone", { skillsCount: ids.length });
      emitTelemetry("gone-frame-received");
      updateStore.clearSeen();
      void reconcileCheckUpdates(ids);
    };

    const openStream = () => {
      if (!mountedRef.current) return;
      es = new EventSource(url);
      debugSse("open-attempt", { url });

      es.onopen = () => {
        if (!mountedRef.current) return;
        cancelFallback();
        setStatus("connected");
        lastConnectedAtRef.current = Date.now();
        debugSse("open", { url });
        emitTelemetry("connected");
      };

      es.onerror = () => {
        if (!mountedRef.current) return;
        debugSse("error", { readyState: es?.readyState });
        armFallback();
        if (es && es.readyState === EventSource.CLOSED) {
          scheduleReconnect();
        }
      };

      es.onmessage = onMessage;
      es.addEventListener("gone", onGone);
    };

    openStream();

    return () => {
      cancelFallback();
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (es) {
        try { es.removeEventListener("gone", onGone); } catch { /* noop */ }
        try { es.close(); } catch { /* noop */ }
      }
    };
  }, [skillsCsv, trackingCsv, streamBase, fallbackMs, reconcileCheckUpdates, emitTelemetry]);

  useEffect(() => {
    if (!trackingCsv) return;
    const ids = trackingCsv.split(",");
    void reconcileCheckUpdates(ids);
  }, [trackingCsv, reconcileCheckUpdates]);

  const dismiss = useCallback((skillId: string) => {
    updateStore.dismiss(skillId);
  }, []);

  return {
    updates,
    updatesMap,
    updateCount,
    isRefreshing,
    lastFetchAt,
    error,
    refresh,
    updatesById,
    pushUpdateCount,
    status,
    dismiss,
  };
}
