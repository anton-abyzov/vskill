// ---------------------------------------------------------------------------
// useDataEvents.ts -- React hooks for server-sent data change events
// ---------------------------------------------------------------------------
// Connects to GET /api/events (SSE) to receive push notifications when
// benchmarks complete, history is written, or leaderboard is updated.

import { useEffect, useRef } from "react";

export type DataEventType = "benchmark:complete" | "history:written" | "leaderboard:updated";

/**
 * Subscribe to all server data events via SSE.
 * Automatically reconnects with exponential backoff on connection loss.
 * Returns a cleanup function — call it to stop the SSE stream.
 */
export function useDataEvents(
  onEvent: (type: DataEventType, data: unknown) => void,
): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      es = new EventSource("/api/events");

      const handleEvent = (type: DataEventType) => (e: MessageEvent) => {
        try {
          const data = e.data ? JSON.parse(e.data) : {};
          onEventRef.current(type, data);
        } catch {
          onEventRef.current(type, {});
        }
      };

      es.addEventListener("benchmark:complete", handleEvent("benchmark:complete"));
      es.addEventListener("history:written", handleEvent("history:written"));
      es.addEventListener("leaderboard:updated", handleEvent("leaderboard:updated"));

      es.onerror = () => {
        es?.close();
        es = null;
        if (!destroyed) {
          reconnectTimer = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, 30000);
            connect();
          }, backoffMs);
        }
      };

      es.onopen = () => {
        backoffMs = 1000; // reset backoff on successful connection
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);
}

/**
 * Subscribe to a specific data event type.
 * Callback is stable-ref'd so consumers don't need to memoize it.
 */
export function useOnDataEvent(
  eventType: DataEventType,
  callback: (data: unknown) => void,
): void {
  useDataEvents((type, data) => {
    if (type === eventType) callback(data);
  });
}
