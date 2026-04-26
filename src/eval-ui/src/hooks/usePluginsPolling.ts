// ---------------------------------------------------------------------------
// usePluginsPolling.ts
//
// Polling hook for GET /api/plugins with controlled retry semantics:
//
//   Backoff schedule (on consecutive failures):
//     attempt 1 → immediate
//     retry 1   → 1s
//     retry 2   → 2s
//     retry 3   → 4s
//     retry 4   → 8s
//     retry 5   → 16s
//     after 5 retries → "paused" state, no further automatic polling
//
//   Pause triggers:
//     - 5 consecutive fetch failures (manual retry() or tab-show resumes)
//     - document.visibilityState === "hidden" (tab-show auto-resumes)
//
//   Abort semantics:
//     - AbortController is created for each in-flight fetch
//     - Unmounting the consuming component calls controller.abort()
//     - No "Failed to fetch" warnings after navigation
//
//   Steady-state:
//     - On success, the next poll is scheduled 60s later (≤ 1 req/min)
//     - Failure backoff intervals count toward that 60s budget
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

// Module-level set of registered refresh callbacks — populated by hook instances.
// Call triggerPluginsRefresh() from anywhere (e.g. after enable/disable mutation)
// to force an immediate re-fetch in all mounted usePluginsPolling consumers.
const refreshCallbacks = new Set<() => void>();

/** Force an immediate re-fetch in all mounted usePluginsPolling hook instances. */
export function triggerPluginsRefresh(): void {
  for (const cb of refreshCallbacks) cb();
}

export interface PluginEntry {
  name: string;
  marketplace: string;
  enabled: boolean;
  scope: string;
}

export interface UsePluginsPollingReturn {
  /** Latest fetched plugin list, or undefined while loading */
  plugins: PluginEntry[] | undefined;
  /** True when all 5 retries are exhausted and polling is suspended */
  paused: boolean;
  /** Loading flag — true while the first fetch is in-flight */
  loading: boolean;
  /** Manually resume after paused state or to force an immediate re-fetch */
  retry: () => void;
}

const MAX_RETRIES = 5;
const BACKOFF_BASE_MS = 1_000;
const POLL_INTERVAL_MS = 60_000;

export function usePluginsPolling(): UsePluginsPollingReturn {
  const [plugins, setPlugins] = useState<PluginEntry[] | undefined>(undefined);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  // Mutable refs so callbacks close over stable references
  const failureCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Incremented by retry() to re-trigger the scheduling effect
  const retryTokenRef = useRef(0);
  const [retryToken, setRetryToken] = useState(0);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const doFetch = useCallback(async () => {
    if (!mountedRef.current) return;
    if (document.visibilityState === "hidden") return;

    abortInFlight();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/plugins", { signal: controller.signal });
      if (!mountedRef.current) return;

      const json = await res.json();
      if (!mountedRef.current) return;

      // Success — reset failure counter, update data, schedule next poll
      failureCountRef.current = 0;
      setPlugins(json.plugins ?? []);
      setLoading(false);
      setPaused(false);

      // F-004: if the tab is hidden when this timer fires, doFetch checks
      // visibilityState first thing and returns early — no fetch occurs and
      // no further timer is scheduled. The visibilitychange listener already
      // calls clearTimer() on hide, so in practice this timer fires while
      // hidden only in a small race window and the early-return absorbs it.
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setRetryToken((t) => t + 1);
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      if (!mountedRef.current) return;
      // Ignore aborts (unmount / visibility pause)
      if (err instanceof DOMException && err.name === "AbortError") return;

      failureCountRef.current += 1;
      setLoading(false);

      if (failureCountRef.current > MAX_RETRIES) {
        setPaused(true);
        return;
      }

      // Schedule next retry with exponential backoff
      const delay = BACKOFF_BASE_MS * Math.pow(2, failureCountRef.current - 1);
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setRetryToken((t) => t + 1);
        }
      }, delay);
    }
  }, [abortInFlight]);

  // Mount / unmount lifecycle
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer();
      abortInFlight();
    };
  }, [abortInFlight]);

  // Kick off a fetch whenever retryToken changes (covers initial mount,
  // scheduled polls, manual retry(), and visibility-resume).
  //
  // F-002 NOTE: `doFetch` identity must remain stable across renders — its
  // `useCallback` deps list is `[abortInFlight]` and `abortInFlight`'s deps
  // list is `[]`, so neither ever changes. The eslint-disable below masks
  // the missing-dep warning. If you ever add state to `doFetch` (e.g.
  // promote `failureCountRef` to state), this scheduling effect will start
  // re-running on every fetch and double-schedule timers — fix the deps
  // here at the same time.
  useEffect(() => {
    if (document.visibilityState === "hidden") return;
    clearTimer();
    void doFetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken, doFetch]);

  // Visibility change listener — pause on hide, resume on show
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Abort any in-flight fetch and clear scheduled timer
        clearTimer();
        abortInFlight();
      } else {
        // Tab became visible — reset failure counter and fetch immediately
        failureCountRef.current = 0;
        setPaused(false);
        setRetryToken((t) => t + 1);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [abortInFlight]);

  const retry = useCallback(() => {
    failureCountRef.current = 0;
    setPaused(false);
    clearTimer();
    retryTokenRef.current += 1;
    setRetryToken((t) => t + 1);
  }, []);

  // Register this instance so triggerPluginsRefresh() can reach it
  useEffect(() => {
    refreshCallbacks.add(retry);
    return () => { refreshCallbacks.delete(retry); };
  }, [retry]);

  return { plugins, paused, loading, retry };
}
