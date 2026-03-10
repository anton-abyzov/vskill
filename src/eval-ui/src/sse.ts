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
        throw new Error(`HTTP ${res.status}`);
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
// Multi-stream SSE hook — one independent stream per case
// ---------------------------------------------------------------------------

export interface CaseStream {
  events: SSEEvent[];
  running: boolean;
  done: boolean;
  error: string | null;
}

export function useMultiSSE() {
  const [streams, setStreams] = useState<Map<number, CaseStream>>(new Map());
  const abortRefs = useRef<Map<number, AbortController>>(new Map());

  const updateStream = useCallback((caseId: number, updater: (prev: CaseStream) => CaseStream) => {
    setStreams((prev) => {
      const next = new Map(prev);
      const current = next.get(caseId) ?? { events: [], running: false, done: false, error: null };
      next.set(caseId, updater(current));
      return next;
    });
  }, []);

  const startCase = useCallback(async (caseId: number, url: string, body?: unknown) => {
    // Abort existing stream for this case if any
    abortRefs.current.get(caseId)?.abort();

    const controller = new AbortController();
    abortRefs.current.set(caseId, controller);

    updateStream(caseId, () => ({ events: [], running: true, done: false, error: null }));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
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
              if (currentEvent === "done") {
                updateStream(caseId, (s) => ({
                  ...s,
                  events: [...s.events, evt],
                  done: true,
                }));
              } else {
                updateStream(caseId, (s) => ({
                  ...s,
                  events: [...s.events, evt],
                }));
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
        updateStream(caseId, (s) => ({ ...s, error: (err as Error).message }));
      }
    } finally {
      updateStream(caseId, (s) => ({ ...s, running: false }));
      abortRefs.current.delete(caseId);
    }
  }, [updateStream]);

  const stopCase = useCallback((caseId: number) => {
    abortRefs.current.get(caseId)?.abort();
  }, []);

  const stopAll = useCallback(() => {
    for (const controller of abortRefs.current.values()) {
      controller.abort();
    }
  }, []);

  const isAnyCaseRunning = useMemo(() => {
    for (const s of streams.values()) {
      if (s.running) return true;
    }
    return false;
  }, [streams]);

  return { streams, startCase, stopCase, stopAll, isAnyCaseRunning };
}
