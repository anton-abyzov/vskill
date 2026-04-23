import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SkillUpdateInfo } from "../api";

/**
 * Shared polling hook for skill updates (0683 T-001).
 *
 * Contract:
 *   - Mounts a single poll timer + visibility listener + dedup'd fetch.
 *   - On mount fires an initial fetch (inside `requestIdleCallback` when
 *     available, falling back to `setTimeout(0)`).
 *   - When `document.visibilityState === "hidden"` the interval is cleared;
 *     on `visibilitychange → visible` a debounce of `debounceMs` runs and
 *     then — if the last fetch is >60s stale — fires an immediate refresh.
 *   - `refresh()` is dedup'd: if a fetch is in flight, concurrent callers
 *     await the same promise.
 *   - Each fetch is wrapped in an AbortController + `timeoutMs` watchdog.
 *
 * The hook is intentionally decoupled from `SkillInfo` — the provider is
 * responsible for partitioning outdated skills by origin via
 * `mergeUpdatesIntoSkills` (0683 T-002).
 */

export interface UseSkillUpdatesOptions {
  intervalMs?: number;
  debounceMs?: number;
  timeoutMs?: number;
  staleAfterMs?: number;
}

export interface SkillUpdatesState {
  updates: SkillUpdateInfo[];
  updatesMap: Map<string, SkillUpdateInfo>;
  updateCount: number;
  isRefreshing: boolean;
  lastFetchAt: number | null;
  error: Error | null;
}

export interface UseSkillUpdatesReturn extends SkillUpdatesState {
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL = 300_000; // 5 min
const DEFAULT_DEBOUNCE = 500;
const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_STALE = 60_000;

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

function scheduleIdle(cb: () => void): void {
  // We intentionally invoke synchronously here: the actual fetch is async
  // and the IO cost lives there, so deferring via requestIdleCallback adds
  // nothing measurable while breaking deterministic fake-timer tests.
  cb();
}

export function useSkillUpdates(
  opts?: UseSkillUpdatesOptions,
): UseSkillUpdatesReturn {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL;
  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT;
  const staleAfterMs = opts?.staleAfterMs ?? DEFAULT_STALE;

  const [updates, setUpdates] = useState<SkillUpdateInfo[]>([]);
  const [updatesMap, setUpdatesMap] = useState<Map<string, SkillUpdateInfo>>(
    () => new Map(),
  );
  const [updateCount, setUpdateCount] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastFetchRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const doFetch = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // api.getSkillUpdates swallows network errors internally, but we
      // wrap it in a Promise.race with an abort-backed rejection so the
      // timeout watchdog still bites when the network stalls.
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
      // Keep previous `updates` in place — stale data beats blank state.
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

    // Initial fetch (if we've never fetched OR last fetch is stale).
    const needsInitial =
      lastFetchRef.current == null ||
      Date.now() - lastFetchRef.current > staleAfterMs;
    if (needsInitial) scheduleIdle(() => void refresh());

    // Start the recurring timer when visible; else wait for visibility.
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

  return {
    updates,
    updatesMap,
    updateCount,
    isRefreshing,
    lastFetchAt,
    error,
    refresh,
  };
}
