// ---------------------------------------------------------------------------
// active-tenant-routes.ts — 0839 T-011 / US-004.
//
// Loopback-only `/__internal/active-tenant` GET/POST handler used by the
// Studio TenantPicker (eval-ui T-012/T-013). Reads/writes
// `~/.vskill/config.json` via the shared helpers in
// `../lib/active-tenant.ts`, so the CLI (`vskill orgs use`) and the
// Studio always agree on which tenant is active.
//
// Why the path doesn't start with `/api/`:
//   The studio-token gate in `router.ts` only applies to `/api/*`. This
//   route is a UX convenience that needs to work without the WebView
//   threading the studio token (it predates the gate). We compensate
//   with three lower-bound guards:
//     1. Loopback-only (req.socket.remoteAddress).
//     2. The eval-server already binds 127.0.0.1 (US-001 hardening).
//     3. The handler refuses anything but GET / POST + tiny body.
//
// Audit logging is intentionally absent — this is a local-only,
// non-secret read/write of the user's own config file. Logging it would
// be noise (and the path itself isn't sensitive).
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { readBody, sendJson } from "./router.js";
import {
  getActiveTenant,
  setActiveTenant,
  type ActiveTenantOptions,
} from "../lib/active-tenant.js";

export interface ActiveTenantRoutesOptions {
  /**
   * Forward to the helpers (tests). Production passes nothing; the
   * helpers default to `~/.vskill/config.json`.
   */
  activeTenantOptions?: ActiveTenantOptions;
}

function isLoopback(req: http.IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
  );
}

/**
 * Returns true when the request was handled (response sent). Returns false
 * when the URL/method doesn't match — the caller (eval-server.ts) falls
 * through to the next handler (proxy / static).
 */
export async function handleActiveTenant(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: ActiveTenantRoutesOptions = {},
): Promise<boolean> {
  const url = req.url || "";
  // Path-based match (no query string is honored, but we strip it just in
  // case the caller appended `?_=` for cache-busting).
  const path = url.split("?")[0];
  if (path !== "/__internal/active-tenant") return false;

  // Loopback guard — the eval-server binds 127.0.0.1 already, but a
  // misconfigured proxy or future port-forward could subvert that.
  if (!isLoopback(req)) {
    sendJson(res, { ok: false, error: "loopback-only" }, 403, req);
    return true;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET") {
    const slug = getActiveTenant(opts.activeTenantOptions);
    sendJson(res, { currentTenant: slug });
    return true;
  }
  if (method === "POST") {
    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      sendJson(res, { ok: false, error: "invalid JSON" }, 400, req);
      return true;
    }
    if (!body || typeof body !== "object") {
      sendJson(res, { ok: false, error: "expected { currentTenant }" }, 400, req);
      return true;
    }
    const incoming = (body as { currentTenant?: unknown }).currentTenant;

    // Accept null (clear) and non-empty string. Reject anything else so
    // we don't silently coerce numbers/booleans into config corruption.
    let slug: string | null;
    if (incoming === null) {
      slug = null;
    } else if (typeof incoming === "string" && incoming.length > 0) {
      // Cheap shape check — slugs are URL-safe DNS labels in the platform
      // schema. Refusing weird input here saves a round-trip to a 4xx
      // tenant lookup later.
      if (!/^[a-z0-9][a-z0-9-]*$/i.test(incoming)) {
        sendJson(
          res,
          { ok: false, error: "invalid slug format" },
          400,
          req,
        );
        return true;
      }
      slug = incoming;
    } else {
      sendJson(
        res,
        { ok: false, error: "currentTenant must be string|null" },
        400,
        req,
      );
      return true;
    }

    try {
      setActiveTenant(slug, opts.activeTenantOptions);
    } catch (err) {
      sendJson(
        res,
        { ok: false, error: (err as Error).message },
        500,
        req,
      );
      return true;
    }
    sendJson(res, { currentTenant: slug });
    return true;
  }

  // Other methods.
  sendJson(res, { ok: false, error: "method not allowed" }, 405, req);
  return true;
}
