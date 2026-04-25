// ---------------------------------------------------------------------------
// platform-proxy.ts — forward unhandled /api/v1/skills/* requests from the
// Skill Studio (eval-server, port-hashed e.g. 3162) to the vskill-platform
// (default https://verified-skill.com — the production worker — for parity
//  with src/api/client.ts:10 DEFAULT_BASE_URL).
//
// Why this exists (0712 US-003 follow-up T-016A/B; default re-targeted in 0725):
//   The studio frontend (src/eval-ui) issues *relative* fetches such as
//   `/api/v1/skills/check-updates` and `/api/v1/skills/stream`. Those land
//   on the eval-server itself, which has no handler for them and returns
//   `{"error":"Not found"}` 404. Production deploys the studio behind the
//   platform (same origin), so relative URLs resolve to the platform; in
//   local dev the studio is served by the eval-server CLI (`vskill studio`),
//   which is a *different* process from the platform. This helper closes
//   the gap by transparently proxying any unhandled `/api/v1/skills/*` path
//   to the platform target.
//
// Design notes:
//   - Target URL is configurable via `VSKILL_PLATFORM_URL` env (default
//     `https://verified-skill.com`). Local-platform devs running their own
//     `wrangler dev` opt back in via `VSKILL_PLATFORM_URL=http://localhost:3017`.
//     Must include scheme + host (port optional for https).
//   - Method, headers (minus hop-by-hop), query string, and request body
//     stream are forwarded verbatim. Response status, headers, and body
//     stream are piped back so SSE (`text/event-stream`) connections stay
//     long-lived without buffering.
//   - Path prefix is preserved exactly (`/api/v1/skills/...`) — the
//     platform routes match the same paths.
//   - Connection failures upstream return a `502 Bad Gateway` JSON
//     envelope so the studio's fetch error handlers see a structured
//     response rather than a hung socket.
// ---------------------------------------------------------------------------

import * as http from "node:http";
import * as https from "node:https";

const DEFAULT_PLATFORM_URL = "https://verified-skill.com";

// Hop-by-hop headers per RFC 2616 §13.5.1 — never forward these on a proxy.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function getPlatformBaseUrl(): string {
  const raw = process.env.VSKILL_PLATFORM_URL;
  if (typeof raw === "string" && raw.length > 0) {
    return raw.replace(/\/$/, "");
  }
  return DEFAULT_PLATFORM_URL;
}

/**
 * Decide whether a given request URL should be proxied to the platform.
 * Today the contract is: any unhandled `/api/v1/skills/*` request goes to
 * the platform. Other `/api/...` paths remain owned by the eval-server.
 */
export function shouldProxyToPlatform(url: string | undefined): boolean {
  if (!url) return false;
  return url.startsWith("/api/v1/skills/");
}

function pickHeadersForUpstream(
  src: http.IncomingHttpHeaders,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "undefined") continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  // Preserve client-IP intent for any future platform-side observability.
  const xff = out["x-forwarded-for"];
  out["x-forwarded-for"] = xff ? `${xff}, 127.0.0.1` : "127.0.0.1";
  return out;
}

function pickHeadersForDownstream(
  src: http.IncomingHttpHeaders,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "undefined") continue;
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Proxy a single HTTP request from the studio to the platform.
 * SSE-safe: streams the upstream body chunks directly to the response so
 * `text/event-stream` connections stay open.
 *
 * Resolves once the proxy pipeline finishes (either side ended) — callers
 * can `await` to know the response has been written, but typical use is
 * fire-and-forget within an HTTP server handler.
 */
export function proxyToPlatform(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  baseUrl: string = getPlatformBaseUrl(),
): Promise<void> {
  return new Promise((resolve) => {
    const target = new URL(req.url ?? "/", baseUrl);
    const transport = target.protocol === "https:" ? https : http;
    const upstreamReq = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: pickHeadersForUpstream(req.headers),
      },
      (upstreamRes) => {
        const status = upstreamRes.statusCode ?? 502;
        const headers = pickHeadersForDownstream(upstreamRes.headers);
        try {
          res.writeHead(status, headers);
        } catch {
          // Headers already sent — fall through to pipe; `res.write` will
          // continue on the existing stream.
        }
        upstreamRes.on("end", () => resolve());
        upstreamRes.on("error", () => {
          if (!res.writableEnded) res.end();
          resolve();
        });
        upstreamRes.pipe(res);
      },
    );

    upstreamReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      if (!res.writableEnded) {
        res.end(
          JSON.stringify({
            error: "platform_unreachable",
            message: `vskill-platform proxy failed: ${err.message}`,
            target: target.origin,
          }),
        );
      }
      resolve();
    });

    // Close upstream cleanly when the client disconnects (esp. EventSource
    // unmounts) so we don't leak sockets on long-lived SSE streams.
    res.on("close", () => {
      try {
        upstreamReq.destroy();
      } catch {
        /* noop */
      }
    });

    // Forward the request body (if any) — req is a readable stream.
    req.pipe(upstreamReq);
  });
}
