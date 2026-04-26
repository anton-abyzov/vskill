// ---------------------------------------------------------------------------
// useSWR.ts -- minimal stale-while-revalidate cache with dedup + invalidation
// ---------------------------------------------------------------------------
// Provides cache-first data fetching with:
//   - Configurable TTL (default 30s) — returns stale data while revalidating
//   - Request deduplication — only one in-flight fetch per key at a time
//   - `mutate(key)` — invalidate cache entry and trigger re-fetch

import { useState, useEffect, useRef } from "react";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface InFlight {
  promise: Promise<unknown>;
  subscribers: Array<() => void>;
}

// Module-level cache shared across all hook instances
const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, InFlight>();
const listeners = new Map<string, Set<() => void>>();

/** Invalidate a cache entry and notify all subscribers to re-fetch. */
export function mutate(key: string): void {
  cache.delete(key);
  inFlight.delete(key);
  const subs = listeners.get(key);
  if (subs) {
    for (const sub of subs) sub();
  }
}

export interface SWROptions {
  /** Cache TTL in milliseconds. Default: 30_000 (30s) */
  ttl?: number;
  /** If false, skip fetching entirely. Default: true */
  enabled?: boolean;
}

export interface SWRResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  /** Manually trigger a re-fetch and invalidate cache */
  revalidate: () => void;
}

/**
 * Minimal SWR hook. Returns cached data immediately while revalidating in the
 * background when the cache entry is stale.
 *
 * @example
 * const { data, loading } = useSWR(
 *   `stats/${plugin}/${skill}`,
 *   () => api.getStats(plugin, skill),
 * );
 */
export function useSWR<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: SWROptions = {},
): SWRResult<T> {
  const { ttl = 30_000, enabled = true } = opts;

  const [, forceUpdate] = useState(0);
  // 0766 F-001: real error state — without it, a rejected fetcher leaves
  // `loading` true forever (no cache entry → `(enabled && !entry)` was always
  // truthy in the old loading formula) and the consumer has no way to render
  // a recovery UI.
  const [errorState, setErrorState] = useState<Error | undefined>(undefined);
  // 0766 F-001: bump on revalidate so the fetch effect re-runs even when
  // [key, fetcher, ttl, enabled] are otherwise stable. Without this,
  // mutate() invalidates the cache but no new fetch ever starts in the same
  // hook instance.
  const [revalidationTick, setRevalidationTick] = useState(0);
  const mountedRef = useRef(true);
  const keyRef = useRef(key);
  keyRef.current = key;

  const revalidate = () => {
    setErrorState(undefined);
    mutate(key);
    setRevalidationTick((n) => n + 1);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to external invalidations for this key.
  // 0766 F-002 follow-on: when an external `mutate(key)` clears the cache,
  // the consumer must also kick off a re-fetch — bumping revalidationTick
  // makes the fetch effect re-run (its deps include revalidationTick).
  // Without this, after mutate the consumer renders with no cache entry +
  // no in-flight fetch + no error → renders the empty/no-data state and
  // never refetches until the component remounts.
  useEffect(() => {
    if (!enabled) return;
    const notify = () => {
      if (mountedRef.current) {
        setRevalidationTick((n) => n + 1);
      }
    };
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(notify);
    return () => { listeners.get(key)?.delete(notify); };
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const entry = cache.get(key) as CacheEntry<T> | undefined;
    const isStale = !entry || Date.now() - entry.fetchedAt > ttl;

    if (!isStale) return; // fresh — no re-fetch needed

    // Deduplicate concurrent requests for the same key
    if (inFlight.has(key)) {
      // Another fetch is already in flight — subscribe to its completion
      const flight = inFlight.get(key)!;
      const onComplete = () => {
        if (mountedRef.current && keyRef.current === key) {
          forceUpdate((n) => n + 1);
        }
      };
      flight.subscribers.push(onComplete);
      return;
    }

    // Start a new fetch
    const flight: InFlight = { promise: Promise.resolve(), subscribers: [] };
    const promise = fetcher().then(
      (data) => {
        cache.set(key, { data, fetchedAt: Date.now() });
        inFlight.delete(key);
        if (mountedRef.current && keyRef.current === key) {
          // 0766 F-001: success path clears any stale error from a previous
          // failed attempt.
          setErrorState(undefined);
          forceUpdate((n) => n + 1);
        }
        for (const sub of flight.subscribers) sub();
      },
      (err) => {
        inFlight.delete(key);
        const errInstance = err instanceof Error ? err : new Error(String(err));
        if (mountedRef.current && keyRef.current === key) {
          // 0766 F-001/F-003: capture the error in state (so consumers can
          // render an error UI and `loading` stops being true) and DO NOT
          // re-throw — the old `throw err` produced an unhandled-promise
          // rejection because nothing awaits the .then result.
          setErrorState(errInstance);
          forceUpdate((n) => n + 1);
        }
        for (const sub of flight.subscribers) sub();
      },
    );
    flight.promise = promise;
    inFlight.set(key, flight);
  }, [key, fetcher, ttl, enabled, revalidationTick]);

  const entry = cache.get(key) as CacheEntry<T> | undefined;

  // 0766 F-001: loading is true ONLY while a request is genuinely in flight
  // (or about to start, before the first effect runs). A rejected fetch
  // surfaces via `error`, NOT via permanent loading.
  const loading = enabled && !entry && !errorState && inFlight.has(key);

  return {
    data: entry?.data,
    loading,
    error: errorState,
    revalidate,
  };
}
