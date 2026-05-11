// ---------------------------------------------------------------------------
// router.ts -- minimal HTTP router adapted from specweave dashboard pattern
//
// 0836 US-002: every /api/* request requires `X-Studio-Token`. The token is
// generated lazily per process and exposed to the Tauri WebView via the
// `get_studio_token` IPC. The previous LOCALHOST_ORIGIN_RE allowlist was
// permissive (any localhost browser tab + DNS rebinding). Replaced with a
// per-launch shared-secret gate using `crypto.timingSafeEqual` (constant
// time over equal-length buffers, length-mismatch fast-rejected).
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
) => Promise<void> | void;

export class Router {
  private routes: Route[] = [];
  options?: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  get(path: string, handler: RouteHandler): void {
    this.addRoute("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): void {
    this.addRoute("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): void {
    this.addRoute("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): void {
    this.addRoute("DELETE", path, handler);
  }

  private addRoute(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const pattern = path.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    this.routes.push({
      method,
      pattern: new RegExp(`^${pattern}$`),
      paramNames,
      handler,
    });
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // 0836 US-002: gate every /api/* request behind the X-Studio-Token. The
    // gate writes 401 + empty body on failure; we return `true` so the
    // server.ts dispatcher treats the response as owned and stops looking
    // for static-file fallbacks (which would otherwise serve index.html
    // for unmatched paths and confuse callers).
    if (!tokenGate(req, res)) {
      return true;
    }

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });

      try {
        await route.handler(req, res, params);
      } catch (err) {
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : "Internal server error";
          const sanitized = message.replace(/\/[^\s:]+/g, "<path>");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: sanitized }));
        }
      }
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// 0836 US-002 — X-Studio-Token (per-launch shared secret).
//
// The previous `LOCALHOST_ORIGIN_RE` allowlist was permissive (any tab on
// `http://localhost:*` could reach the bearer-injecting proxy, and DNS
// rebinding subverted it). It is REMOVED. Each /api/* request must now
// carry `X-Studio-Token: <token>`; the token lives only in the eval-server
// process memory and is delivered to the Tauri WebView via IPC and to the
// CLI via stdout banner.
// ---------------------------------------------------------------------------

let _studioToken: string | null = null;

/**
 * Lazily generate (or return) the per-process studio token. 32 bytes of
 * `crypto.randomBytes` encoded as base64url — 256 bits of entropy, 43 chars,
 * URL-safe and header-safe. Never persisted; rotated on every restart.
 */
export function getStudioToken(): string {
  if (_studioToken == null) {
    _studioToken = randomBytes(32).toString("base64url");
  }
  return _studioToken;
}

/** Test-only — never call from production code. */
export function _resetStudioTokenForTests(): void {
  _studioToken = null;
}

/**
 * Constant-time token comparison. `crypto.timingSafeEqual` requires equal-
 * length buffers; we length-check first (the token length is a public
 * constant, so the early return leaks no secret). String === would be V8
 * short-circuit and timing-leaky.
 */
export function tokensEqual(
  supplied: string | undefined | null,
  expected: string,
): boolean {
  if (typeof supplied !== "string") return false;
  if (supplied.length !== expected.length) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return timingSafeEqual(a, b);
}

/**
 * Returns true when the request is allowed to proceed. Returns false AND
 * writes a 401 (empty body) when the gate rejects.
 *
 * Bypasses:
 *   - any non-/api/* path (static files, root, eval-ui shell)
 *   - OPTIONS preflight (CORS handshake; no token possible from XHR)
 */
export function tokenGate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  const rawUrl = req.url || "/";
  // 0836 followup (Codex H#4): normalize req.url through URL parsing so that
  // an absolute-form request target (e.g. `GET http://127.0.0.1:3077/api/git/status`)
  // gates by its parsed pathname, not by the raw string. Without this,
  // `rawUrl.startsWith("/api/")` returns false for absolute-form URLs and
  // the router's pathname-based dispatch happily executes the route.
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  } catch {
    // Truly malformed URL — let the underlying handlers reject it.
    return true;
  }

  // Non-/api paths are static / SPA shell — never gated.
  if (!pathname.startsWith("/api/")) return true;
  // CORS preflight cannot send custom headers; let it pass.
  if ((req.method || "GET").toUpperCase() === "OPTIONS") return true;
  // 0836 followup (Codex C#1): /api/health is the unauthenticated liveness
  // probe used by the desktop sidecar boot. The Tauri shell calls it BEFORE
  // it has parsed the studio_token from the sidecar's stdout, so token-gating
  // it would deadlock the chicken-and-egg: the token comes from the running
  // server, but the server has to be reachable to deliver it. Loopback bind
  // (US-001) is the network-level guard for /api/health.
  if (pathname === "/api/health") return true;
  // 0843 followup (2026-05-11): the GitHub OAuth Authorization Code callback
  // is hit by the user's browser AFTER they authorize at github.com — there's
  // no way for that request to carry X-Studio-Token. It's effectively a
  // browser-driven redirect, not a JS-initiated API call. The endpoint itself
  // is CSRF-protected via the `state` param (validated against an in-memory
  // per-flow store), so exempting from the token gate is safe.
  if (pathname === "/api/oauth/github/callback") return true;

  const supplied = readHeader(req, "x-studio-token");
  const expected = getStudioToken();
  if (tokensEqual(supplied, expected)) return true;

  // Reject. Empty body avoids leaking the expected-length info beyond what
  // a fixed 401 signals. Log at WARN — and crucially WITHOUT the supplied
  // token value (a wrong-length attempt could still be sensitive in CI logs).
  // We log the path + method only.
  if (!res.headersSent) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("");
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[router] X-Studio-Token rejected for ${req.method || "GET"} ${pathname}`,
  );
  return false;
}

function readHeader(
  req: http.IncomingMessage,
  name: string,
): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0];
  return undefined;
}

export function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status = 200,
  _req?: http.IncomingMessage,
): void {
  // 0836 US-002: CORS Origin-allowlist deleted. The studio-token gate is the
  // sole authn for /api/*; any caller that passes the gate is same-origin
  // for our purposes (Tauri WebView, vskill CLI's curl, Playwright, dev).
  // We do not echo Access-Control-Allow-* headers anymore.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

export async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const MAX_BODY_SIZE = 1024 * 1024;
  const TIMEOUT_MS = 10_000;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error("Request body timeout"));
    }, TIMEOUT_MS);
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        clearTimeout(timer);
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString();
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
