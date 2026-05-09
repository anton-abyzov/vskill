// ---------------------------------------------------------------------------
// ops routes — studio ops-log REST + SSE
// ---------------------------------------------------------------------------
// GET    /api/studio/ops            — paginated JSON (AC-US4-05)
// GET    /api/studio/ops/stream     — long-lived SSE op stream (AC-US4-04)
// DELETE /api/studio/ops/:id        — tombstone (soft delete)
// ---------------------------------------------------------------------------

import * as http from "node:http";

import type { Router } from "../../eval-server/router.js";
import { sendJson } from "../../eval-server/router.js";
import { initSSE, sendSSE } from "../../eval-server/sse-helpers.js";
import { listOps, subscribe, deleteOp } from "../lib/ops-log.js";
import { parseQuery } from "../lib/query.js";

// One ticker fans out to every connected SSE client instead of one timer
// per connection. Lazily started on first subscriber, stopped when the
// last leaves. `.unref()` so an idle ticker doesn't block process exit.
const HEARTBEAT_MS = 3000;
const heartbeatClients = new Set<http.ServerResponse>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function startHeartbeatIfNeeded(): void {
  if (heartbeatTimer || heartbeatClients.size === 0) return;
  heartbeatTimer = setInterval(() => {
    const ts = Date.now();
    for (const res of heartbeatClients) {
      try {
        sendSSE(res, "heartbeat", { ts });
      } catch {
        // Stream closed mid-fan-out — drop it now to avoid a stuck client
        // keeping the timer alive after the connection ended.
        heartbeatClients.delete(res);
      }
    }
    if (heartbeatClients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, HEARTBEAT_MS);
  heartbeatTimer.unref();
}

export function registerOpsRoutes(router: Router): void {
  // GET /api/studio/ops?limit=50&before=<ts>
  router.get(
    "/api/studio/ops",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      const q = parseQuery(req.url);
      const limitRaw = q.get("limit");
      const beforeRaw = q.get("before");
      const limit = limitRaw != null ? Number(limitRaw) : 50;
      const before = beforeRaw != null ? Number(beforeRaw) : undefined;

      const ops = await listOps({
        limit: Number.isFinite(limit) ? limit : 50,
        before: before != null && Number.isFinite(before) ? before : undefined,
      });
      sendJson(res, { ok: true, ops }, 200, req);
    },
  );

  // GET /api/studio/ops/stream — long-lived SSE of new op events + heartbeat.
  router.get(
    "/api/studio/ops/stream",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      initSSE(res, req);

      const unsub = subscribe((op) => {
        try {
          sendSSE(res, "op", op);
        } catch {
          // Writing after stream close — safe to swallow.
        }
      });

      heartbeatClients.add(res);
      startHeartbeatIfNeeded();

      const cleanup = () => {
        heartbeatClients.delete(res);
        unsub();
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    },
  );

  // DELETE /api/studio/ops/:id — tombstone.
  router.delete(
    "/api/studio/ops/:id",
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      const { id } = params;
      if (!id) {
        sendJson(res, { ok: false, error: "missing id" }, 400, req);
        return;
      }
      await deleteOp(id);
      sendJson(res, { ok: true, id }, 200, req);
    },
  );
}
