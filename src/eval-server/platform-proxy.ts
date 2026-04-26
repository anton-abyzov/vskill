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
//
// SSE subscription ID-format contract (0736 / AC-US3-04)
// -------------------------------------------------------
// /api/v1/skills/stream is forwarded verbatim to the platform's UpdateHub.
// The `?skills=<csv>` query param MUST contain UUID (`Skill.id`) or public
// slug (`sk_published_<owner>/<repo>/<skill>`) identifiers — NOT the studio's
// local `<plugin>/<skill>` name format (e.g. `.claude/greet-anton`).
//
// The studio side resolves platform IDs via the `resolveSubscriptionIds()`
// helper (src/eval-ui/src/utils/resolveSubscriptionIds.ts) before opening
// the EventSource. Skills without a resolvable UUID or slug are omitted from
// the filter; the polling fallback (usePluginsPolling) covers them so no
// updates are lost. See useSkillUpdates.ts for the full hook-side contract.
//
// This proxy does NOT transform or validate the `?skills=` parameter — it
// forwards exactly what the studio sends. Correctness is the studio's
// responsibility (enforced in resolveSubscriptionIds + useSkillUpdates).
// ---------------------------------------------------------------------------

import * as http from "node:http";
import * as https from "node:https";
import { randomUUID } from "node:crypto";

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

// ---------------------------------------------------------------------------
// submitSkillUpdateEvent — push a SkillUpdateEvent to the platform's internal
// publish queue (POST /api/v1/internal/skills/publish). Used by the studio
// after apply-improvement / create-update so the platform UpdateHub fans out
// the new version to SSE subscribers without waiting for the 10-min scanner.
//
// Requires INTERNAL_BROADCAST_KEY env on both sides (eval-server + platform).
// In production the studio doesn't carry the key, so this degrades to a no-op
// returning { submitted: false, reason: "no_internal_key" } — the caller logs
// a hint that the user should `git push` so the scanner picks the change up.
//
// The publish endpoint (vskill-platform/src/app/api/v1/internal/skills/publish)
// validates `skillId` (UUID), `version`, `gitSha`, `publishedAt`, `eventId`.
// For local-dev with INTERNAL_BROADCAST_KEY set, callers can pass any string
// skillId (e.g. "<plugin>/<skill>") — the DO accepts the event but SSE filters
// based on UUID won't match. That's fine for the integration test path.
// ---------------------------------------------------------------------------

export interface SubmitSkillUpdateEventInput {
  skillId: string;
  version: string;
  gitSha?: string;
  publishedAt?: string;
  diffSummary?: string;
}

export type SubmitSkillUpdateEventResult =
  | { submitted: true; status: number; eventId: string }
  | { submitted: false; reason: "no_internal_key" | "platform_error"; status?: number; message?: string };

export async function submitSkillUpdateEvent(
  input: SubmitSkillUpdateEventInput,
  opts: { baseUrl?: string; internalKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<SubmitSkillUpdateEventResult> {
  const internalKey = opts.internalKey ?? process.env.INTERNAL_BROADCAST_KEY;
  if (!internalKey) {
    return { submitted: false, reason: "no_internal_key" };
  }

  const baseUrl = opts.baseUrl ?? getPlatformBaseUrl();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const eventId = randomUUID();
  const event = {
    type: "skill.updated" as const,
    eventId,
    skillId: input.skillId,
    version: input.version,
    gitSha: input.gitSha ?? `local-${Date.now().toString(16)}`,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    ...(input.diffSummary ? { diffSummary: input.diffSummary } : {}),
  };

  try {
    const resp = await fetchImpl(`${baseUrl}/api/v1/internal/skills/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Key": internalKey,
      },
      body: JSON.stringify(event),
    });
    if (resp.ok) {
      return { submitted: true, status: resp.status, eventId };
    }
    const text = await resp.text().catch(() => "");
    return {
      submitted: false,
      reason: "platform_error",
      status: resp.status,
      message: text || resp.statusText,
    };
  } catch (err) {
    return {
      submitted: false,
      reason: "platform_error",
      message: (err as Error).message,
    };
  }
}
