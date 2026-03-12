// SSE consumer using fetch + ReadableStream (supports POST)
import { useCallback, useRef, useState, useMemo } from "react";

export interface SSEEvent<T = unknown> {
  event: string;
  data: T;
}

export function useSSE<T = unknown>() {
  const [events, setEvents] = useState<SSEEvent<T>[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(async (url: string, body?: unknown) => {
    setEvents([]);
    setRunning(true);
    setDone(false);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              const evt: SSEEvent<T> = { event: currentEvent, data };
              if (currentEvent === "done") {
                setDone(true);
                setEvents((prev) => [...prev, evt]);
              } else {
                setEvents((prev) => [...prev, evt]);
              }
            } catch {
              // skip malformed data
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { events, running, done, error, start, stop };
}

// ---------------------------------------------------------------------------
// Multi-stream SSE hook — callback-based, zero accumulation
//
// Events are NOT stored in React state. Instead, the caller provides
// callbacks (onEvent, onDone, onError) that fire exactly once per SSE event.
// Only the running-state Set lives in React state (for re-render triggers).
// ---------------------------------------------------------------------------

export interface MultiSSECallbacks {
  onEvent: (caseId: number, evt: SSEEvent) => void;
  onDone: (caseId: number) => void;
  onError: (caseId: number, error: string) => void;
}

export function useMultiSSE(callbacks: MultiSSECallbacks) {
  // Stable ref for callbacks — avoids recreating streams when callbacks change
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const [runningSet, setRunningSet] = useState<Set<number>>(new Set());
  const abortRefs = useRef<Map<number, AbortController>>(new Map());

  const startCase = useCallback(async (caseId: number, url: string, body?: unknown) => {
    // Abort existing stream for this case if any
    abortRefs.current.get(caseId)?.abort();

    const controller = new AbortController();
    abortRefs.current.set(caseId, controller);

    setRunningSet((prev) => {
      const next = new Set(prev);
      next.add(caseId);
      return next;
    });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              const evt: SSEEvent = { event: currentEvent, data };
              cbRef.current.onEvent(caseId, evt);
            } catch {
              // skip malformed data
            }
            currentEvent = "";
          }
        }
      }

      // Stream ended cleanly — notify done
      cbRef.current.onDone(caseId);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        cbRef.current.onError(caseId, (err as Error).message);
      }
    } finally {
      setRunningSet((prev) => {
        const next = new Set(prev);
        next.delete(caseId);
        return next;
      });
      abortRefs.current.delete(caseId);
    }
  }, []);

  const stopCase = useCallback((caseId: number) => {
    abortRefs.current.get(caseId)?.abort();
  }, []);

  const stopAll = useCallback(() => {
    for (const controller of abortRefs.current.values()) {
      controller.abort();
    }
  }, []);

  const isAnyCaseRunning = runningSet.size > 0;

  return { runningSet, startCase, stopCase, stopAll, isAnyCaseRunning };
}
