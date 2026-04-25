import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../api";
import type { SkillUpdateInfo } from "../api";
import type { SkillUpdateEvent, StreamStatus, UpdateStoreEntry } from "../types/skill-update";
import { updateStore } from "../stores/updateStore";

/**
 * Shared update hook — polling (0683) + SSE push (0708).
 *
 * Responsibilities:
 *   - Polling path (0683): `updates`, `updatesMap` (keyed by short-name),
 *     `updateCount`, `refresh`, `lastFetchAt`, `error`. Preserves the exact
 *     public contract that UpdateBell, SidebarSection, UpdateToast, and
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
 *     (AC-US5-11) — no toast fires. Visible-tab event arrivals dispatch a
 *     `studio:toast` CustomEvent; hidden-tab arrivals only update the store
 *     (AC-US5-02). Components consume `updatesById` + `status` for the
 *     push-driven surfaces.
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
   * When non-empty, the hook opens a single EventSource filtered to these
   * IDs. The list is sorted for URL stability; changes cause reconnect.
   * Omit or pass `[]` to disable SSE (useful for routes that don't need it).
   */
  skillIds?: string[];
  /**
   * 0708 wrap-up: skill IDs to query for tracking state (`trackedForUpdates`)
   * via the platform's `/api/v1/skills/check-updates` endpoint. Distinct
   * from `skillIds` because the SSE filter is scoped to installed skills
   * (AC-US5-08), but the not-tracked dot (AC-US5-09) needs tracking state
   * for ALL visible skills — including source-origin ones in dev/E2E.
   * Defaults to the same list as `skillIds`.
   */
  trackingSkillIds?: string[];
  /**
   * 0708 fallback watchdog — how long to wait for a sustained `connected`
   * signal before flipping `status: "fallback"`. Defaults to 60 s per
   * AC-US5-05.
   */
  disconnectFallbackMs?: number;
  /** 0708: Override `/api/v1/skills/stream` path (test injection only). */
  streamUrlBase?: string;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMap(list: SkillUpdateInfo[]): Map<string, SkillUpdateInfo> {
  const out = new Map<string, SkillUpdateInfo>();
  for (const u of list) {
    const shortName = u.name.split("/").pop() || u.name;
    out.set(shortName, u);
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

  // External-store snapshot for the push-driven map. Components can also read
  // `updateStore.getSnapshot()` directly — this mirror keeps the hook return
  // value React-identity-stable.
  const updatesById = useSyncExternalStore(
    (l) => updateStore.subscribe(l),
    () => updateStore.getSnapshot(),
    () => updateStore.getSnapshot(),
  );
  const pushUpdateCount = updatesById.size;

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

  // Reconciliation helper — shared by gone-frame handler, 409 fallback, AND
  // the on-mount tracking-state reconciliation (0708 wrap-up: AC-US5-09 needs
  // `trackedForUpdates` to surface for SidebarSection / RightPanel).
  const reconcileCheckUpdates = useCallback(async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    try {
      const rows = await api.checkSkillUpdates(ids);
      if (!mountedRef.current || rows.length === 0) return;
      const now = Date.now();
      // Push-store path — only entries with a real eventId+version go here
      // (drives the blue dot + bell).
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
      // Polling-shape merge — feeds mergeUpdatesIntoSkills so the not-tracked
      // dot can surface even when no push event has fired. Only entries that
      // carry `trackedForUpdates` or update flags go through here.
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
        // Merge with existing polling updates by short-name. We only fill in
        // FIELDS the legacy poll doesn't already provide — primarily
        // `trackedForUpdates`. This prevents check-updates' tracking-state
        // response (which can lag the legacy poll's update detection) from
        // overwriting `updateAvailable: true` with stale `false`.
        setUpdates((prev) => {
          const map = new Map<string, SkillUpdateInfo>();
          for (const u of prev) map.set(u.name.split("/").pop() || u.name, u);
          let added = 0;
          for (const u of pollEntries) {
            const key = u.name.split("/").pop() || u.name;
            const existing = map.get(key);
            if (existing) {
              // Only fill the gap fields — never overwrite live update state.
              const enriched: SkillUpdateInfo = { ...existing };
              if (existing.trackedForUpdates === undefined && u.trackedForUpdates !== undefined) {
                enriched.trackedForUpdates = u.trackedForUpdates;
              }
              map.set(key, enriched);
            } else {
              // No legacy entry — synthesize from check-updates so the not-
              // tracked dot can render. Defaults `updateAvailable` to false
              // so the bell does not increment.
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
            // No structural change, no fields enriched → bail to avoid an
            // unnecessary state churn (and the merge path being re-run by
            // downstream useMemos).
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
    // 0708 wrap-up: open SSE whenever the user has ANY visible skills, not
    // only installed ones. The server enforces the AC-US5-08 filter (it
    // only fans out events for skills the user has installed) so the wider
    // subscription is safe — and it keeps the reconnect/fallback contracts
    // exercisable in dev/E2E where source-origin skills dominate.
    const csvForSubscribe = skillsCsv || trackingCsv;
    if (!csvForSubscribe) {
      // No skills at all → no SSE. We're considered 'fallback' so the
      // polling path still drives updates; components can key off `status`
      // if they need to degrade.
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

    // Watchdog: if we haven't reached 'connected' within fallbackMs, flip to
    // 'fallback'. Any later onopen flips back to 'connected' and cancels
    // the watchdog (if still pending).
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const armFallback = () => {
      if (fallbackTimer != null) return;
      fallbackTimer = setTimeout(() => {
        fallbackTimer = null;
        if (!mountedRef.current) return;
        if (statusRef.current !== "connected") setStatus("fallback");
      }, fallbackMs);
    };
    const cancelFallback = () => {
      if (fallbackTimer != null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };
    armFallback();

    // 0708 wrap-up: explicit reconnect on EventSource.CLOSED. Browsers
    // auto-reconnect on `onerror` while in CONNECTING/OPEN, but if the
    // connection terminates abruptly (e.g. `route.abort('connectionclosed')`
    // in Playwright, or a server-side 5xx that closes the socket) the
    // EventSource ends up in CLOSED and never tries again. We force a fresh
    // EventSource with a small backoff so the AC-US5-05 reconnect contract
    // holds across all drop modes.
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
      if (outcome === "duplicate") return;
      // Visibility-gated toast (AC-US5-02).
      const isVisible =
        typeof document === "undefined" ||
        document.visibilityState !== "hidden";
      if (isVisible) {
        const msg = `${payload.skillId} updated to ${payload.version}`;
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
      }
    };

    const onGone = () => {
      if (!mountedRef.current) return;
      // Gone-frame reconciliation (AC-US5-11): wipe dedup state, reconcile
      // silently via /check-updates, then resume consuming live events.
      updateStore.clearSeen();
      void reconcileCheckUpdates(ids);
    };

    const openStream = () => {
      if (!mountedRef.current) return;
      es = new EventSource(url);

      es.onopen = () => {
        if (!mountedRef.current) return;
        cancelFallback();
        setStatus("connected");
      };

      es.onerror = () => {
        if (!mountedRef.current) return;
        // Two cases:
        //   1. Connection still alive (transient hiccup) — browser will
        //      auto-reconnect; we just (re-)arm the fallback watchdog.
        //   2. Socket closed by peer / aborted — readyState becomes CLOSED
        //      and the browser stops. We schedule an explicit reconnect.
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
  }, [skillsCsv, trackingCsv, streamBase, fallbackMs, reconcileCheckUpdates]);

  // 0708 wrap-up: tracking-state reconciliation effect. Fires when the wider
  // tracking list changes (covers source-origin skills too). Populates
  // `trackedForUpdates` flags so SidebarSection / RightPanel can render the
  // not-tracked dot (AC-US5-09) without waiting for a push event.
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
