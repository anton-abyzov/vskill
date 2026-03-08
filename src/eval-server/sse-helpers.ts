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
