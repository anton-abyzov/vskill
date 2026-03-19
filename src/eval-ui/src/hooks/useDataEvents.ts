// ---------------------------------------------------------------------------
// useDataEvents.ts -- React hooks for server-sent data change events
// ---------------------------------------------------------------------------
// SINGLETON CONNECTION: All components share one EventSource to /api/events.
// Automatically reconnects with exponential backoff on connection loss.

import { useEffect, useRef } from "react";

export type DataEventType = "benchmark:complete" | "history:written" | "leaderboard:updated";

type Listener = (data: unknown) => void;

// Module-level singleton — shared across all hook instances
const listeners = new Map<DataEventType, Set<Listener>>();
let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1000;
let refCount = 0;

function ensureConnection(): void {
  if (es) return;

  es = new EventSource("/api/events");

  const handleEvent = (type: DataEventType) => (e: MessageEvent) => {
    let data: unknown = {};
    try { data = e.data ? JSON.parse(e.data) : {}; } catch { /* use empty */ }
    const subs = listeners.get(type);
    if (subs) {
      for (const cb of subs) cb(data);
    }
  };

  es.addEventListener("benchmark:complete", handleEvent("benchmark:complete"));
  es.addEventListener("history:written", handleEvent("history:written"));
  es.addEventListener("leaderboard:updated", handleEvent("leaderboard:updated"));

  es.onerror = () => {
    es?.close();
    es = null;
    if (refCount > 0) {
      reconnectTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, 30000);
        ensureConnection();
      }, backoffMs);
    }
  };

  es.onopen = () => {
    backoffMs = 1000;
  };
}

function closeConnection(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es?.close();
  es = null;
}

function subscribe(type: DataEventType, cb: Listener): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(cb);
  refCount++;
  ensureConnection();

  return () => {
    listeners.get(type)?.delete(cb);
    refCount--;
    if (refCount <= 0) {
      refCount = 0;
      closeConnection();
    }
  };
}

/**
 * Subscribe to a specific data event type.
 * Uses a singleton EventSource connection shared across all components.
 */
export function useOnDataEvent(
  eventType: DataEventType,
  callback: (data: unknown) => void,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    const wrapper: Listener = (data) => cbRef.current(data);
    return subscribe(eventType, wrapper);
  }, [eventType]);
}
