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

/**
 * Wrap an async operation with periodic heartbeat SSE events.
 * Emits a progress event every `intervalMs` with elapsed time so the
 * frontend knows the system is still alive during long LLM calls.
 */
export async function withHeartbeat<T>(
  res: http.ServerResponse,
  evalId: number,
  phase: string,
  messagePrefix: string,
  fn: () => Promise<T>,
  intervalMs = 3000,
): Promise<T> {
  const start = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    sendSSE(res, "progress", {
      eval_id: evalId,
      phase,
      message: `${messagePrefix} (${elapsed}s)`,
    });
  }, intervalMs);

  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
