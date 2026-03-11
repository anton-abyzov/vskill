// ---------------------------------------------------------------------------
// sse-helpers.ts -- SSE event emission utilities
// ---------------------------------------------------------------------------

import type * as http from "node:http";

export function initSSE(
  res: http.ServerResponse,
  req?: http.IncomingMessage,
): void {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  const origin = req?.headers?.origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  res.writeHead(200, headers);
}

export function sendSSE(
  res: http.ServerResponse,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function sendSSEDone(
  res: http.ServerResponse,
  data: unknown,
): void {
  sendSSE(res, "done", data);
  res.end();
}

export interface DynamicHeartbeat {
  update(phase: string, message: string): void;
  stop(): void;
}

/**
 * Start a dynamic heartbeat that can switch phase/message on the fly.
 * Unlike `withHeartbeat`, this is imperative: call `update()` to change
 * what the next tick emits, and `stop()` when done.
 */
export function startDynamicHeartbeat(
  res: http.ServerResponse,
  evalId: number | undefined,
  initialPhase: string,
  initialMessage: string,
  intervalMs = 3000,
): DynamicHeartbeat {
  const start = Date.now();
  let currentPhase = initialPhase;
  let currentMessage = initialMessage;
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    const data: Record<string, unknown> = {
      phase: currentPhase,
      message: `${currentMessage} (${elapsed}s)`,
      elapsed_ms: Date.now() - start,
    };
    if (evalId != null) data.eval_id = evalId;
    sendSSE(res, "progress", data);
  }, intervalMs);

  return {
    update(phase: string, message: string) {
      currentPhase = phase;
      currentMessage = message;
      const elapsed = Math.round((Date.now() - start) / 1000);
      const data: Record<string, unknown> = {
        phase,
        message: `${message} (${elapsed}s)`,
        elapsed_ms: Date.now() - start,
      };
      if (evalId != null) data.eval_id = evalId;
      sendSSE(res, "progress", data);
    },
    stop() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/**
 * Wrap an async operation with periodic heartbeat SSE events.
 * Emits a progress event every `intervalMs` with elapsed time so the
 * frontend knows the system is still alive during long LLM calls.
 */
export async function withHeartbeat<T>(
  res: http.ServerResponse,
  evalId: number | undefined,
  phase: string,
  messagePrefix: string,
  fn: () => Promise<T>,
  intervalMs = 3000,
): Promise<T> {
  const start = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    const data: Record<string, unknown> = {
      phase,
      message: `${messagePrefix} (${elapsed}s)`,
      elapsed_ms: Date.now() - start,
    };
    if (evalId != null) data.eval_id = evalId;
    sendSSE(res, "progress", data);
  }, intervalMs);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
