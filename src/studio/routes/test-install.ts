// ---------------------------------------------------------------------------
// test-install route — POST /api/skills/:plugin/:skill/test-install
// ---------------------------------------------------------------------------
// AC-US2-01 (SSE started→copied→indexed→done; reuses copyPluginFiltered via
//             transfer() in scope-transfer lib — no duplicate copy logic)
// AC-US2-02 (?dest=global → ~/.claude/skills; default INSTALLED)
// AC-US2-03 (dest appears after scanner refresh — signaled via indexed event)
// AC-US2-04 (collision → 409 without ?overwrite)
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

import type { Router } from "../../eval-server/router.js";
import { sendJson } from "../../eval-server/router.js";
import { initSSE, sendSSE, sendSSEDone } from "../../eval-server/sse-helpers.js";
import {
  transfer,
  CollisionError,
  MissingSourceError,
  resolveScopePath,
} from "../lib/scope-transfer.js";
import { appendOp } from "../lib/ops-log.js";
import { parseQuery } from "../lib/query.js";
import type { SkillScope, StudioOp, TransferEvent } from "../types.js";

export function registerTestInstallRoute(
  router: Router,
  root: string,
  home: string = homedir(),
): void {
  router.post(
    "/api/skills/:plugin/:skill/test-install",
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      const { plugin, skill } = params;
      const query = parseQuery(req.url);
      const overwrite = query.get("overwrite") === "true";
      const destRaw = query.get("dest");
      const toScope: SkillScope = destRaw === "global" ? "global" : "installed";

      const sourcePath = resolveScopePath("own", root, skill, home);
      const destPath = resolveScopePath(toScope, root, skill, home);
      const opId = randomUUID();

      // Pre-validate so collisions / missing-source return clean HTTP codes.
      if (!existsSync(sourcePath)) {
        sendJson(res, { ok: false, code: "missing-source", path: sourcePath }, 404, req);
        return;
      }
      if (existsSync(destPath) && !overwrite) {
        sendJson(res, { ok: false, code: "collision", path: destPath }, 409, req);
        return;
      }

      const emit = (e: TransferEvent) => {
        if (!res.headersSent) initSSE(res, req);
        sendSSE(res, e.type, e);
      };

      try {
        emit({
          type: "started",
          opId,
          skillId: `${plugin}/${skill}`,
          fromScope: "own",
          toScope,
          sourcePath,
          destPath,
        });

        const result = await transfer(
          { plugin, skill, fromScope: "own", toScope, root, home, overwrite },
          emit,
        );

        emit({ type: "indexed" });

        const op: StudioOp = {
          id: opId,
          ts: Date.now(),
          op: "test-install",
          skillId: `${plugin}/${skill}`,
          fromScope: "own",
          toScope,
          paths: { source: sourcePath, dest: result.destPath },
          actor: "studio-ui",
          details: { filesWritten: result.filesWritten },
        };
        await appendOp(op);

        sendSSEDone(res, { type: "done", opId, destPath: result.destPath });
      } catch (err) {
        if (err instanceof CollisionError) {
          if (res.headersSent) {
            sendSSE(res, "error", { type: "error", code: "collision", message: err.message, path: err.path });
            res.end();
          } else {
            sendJson(res, { ok: false, code: "collision", path: err.path }, 409, req);
          }
          return;
        }
        if (err instanceof MissingSourceError) {
          if (res.headersSent) {
            sendSSE(res, "error", { type: "error", code: "missing-source", message: err.message });
            res.end();
          } else {
            sendJson(res, { ok: false, code: "missing-source", path: err.path }, 404, req);
          }
          return;
        }
        const message = err instanceof Error ? err.message : "unknown error";
        if (res.headersSent) {
          sendSSE(res, "error", { type: "error", code: "io-error", message });
          res.end();
        } else {
          sendJson(res, { ok: false, code: "io-error", error: message }, 500, req);
        }
      }
    },
  );
}
