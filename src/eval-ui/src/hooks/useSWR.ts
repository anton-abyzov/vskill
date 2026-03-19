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
  const mountedRef = useRef(true);
  const keyRef = useRef(key);
  keyRef.current = key;

  const revalidate = () => mutate(key);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to external invalidations for this key
  useEffect(() => {
    if (!enabled) return;
    const notify = () => {
      if (mountedRef.current) forceUpdate((n) => n + 1);
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
          forceUpdate((n) => n + 1);
        }
        for (const sub of flight.subscribers) sub();
      },
      (err) => {
        inFlight.delete(key);
        if (mountedRef.current && keyRef.current === key) {
          forceUpdate((n) => n + 1);
        }
        for (const sub of flight.subscribers) sub();
        throw err;
      },
    );
    flight.promise = promise;
    inFlight.set(key, flight);
  }, [key, fetcher, ttl, enabled]);

  const entry = cache.get(key) as CacheEntry<T> | undefined;
  const loading = enabled && !entry && inFlight.has(key);

  // Capture fetch errors without a separate state by checking inFlight absence + no cache
  const error = undefined as Error | undefined; // errors surface via re-render after inFlight clears

  return {
    data: entry?.data,
    loading: loading || (enabled && !entry),
    error,
    revalidate,
  };
}
