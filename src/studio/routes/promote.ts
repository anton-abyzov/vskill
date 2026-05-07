// ---------------------------------------------------------------------------
// promote route — POST /api/skills/:plugin/:skill/promote
// ---------------------------------------------------------------------------
// AC-US1-01 (SSE sequence started → copied → indexed → done)
// AC-US1-03 (collision → 409 {ok:false,code:"collision",path})
// AC-US1-04 (.vskill-meta.json provenance sidecar written to dest)
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
import { writeProvenance } from "../lib/provenance.js";
import { appendOp } from "../lib/ops-log.js";
import { parseQuery } from "../lib/query.js";
import type { Provenance, SkillScope, StudioOp, TransferEvent } from "../types.js";

export function registerPromoteRoute(
  router: Router,
  root: string,
  home: string = homedir(),
): void {
  router.post(
    "/api/skills/:plugin/:skill/promote",
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      const { plugin, skill } = params;
      const query = parseQuery(req.url);
      const overwrite = query.get("overwrite") === "true";
      const fromScopeRaw = (query.get("from") || "installed") as SkillScope;
      const fromScope: SkillScope = fromScopeRaw === "global" ? "global" : "installed";

      const sourcePath = resolveScopePath(fromScope, root, skill, home);
      const destPath = resolveScopePath("own", root, skill, home);
      const opId = randomUUID();

      // Pre-validate BEFORE opening the SSE stream so collisions and missing-
      // source errors return clean HTTP status codes (409 / 404) per AC-US1-03.
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
        // started — emitted before copy so client can capture FLIP rect.
        emit({
          type: "started",
          opId,
          skillId: `${plugin}/${skill}`,
          fromScope,
          toScope: "own",
          sourcePath,
          destPath,
        });

        const result = await transfer(
          { plugin, skill, fromScope, toScope: "own", root, home, overwrite },
          emit,
        );

        // Provenance sidecar (AC-US1-04)
        const provenance: Provenance = {
          promotedFrom: fromScope as "installed" | "global",
          sourcePath,
          promotedAt: Date.now(),
        };
        await writeProvenance(result.destPath, provenance);

        // Indexed event — scanner refresh hook (250ms debounce per ADR; for now
        // we just signal the milestone; the actual scanner runs out-of-band in
        // the live system).
        emit({ type: "indexed" });

        // Op-log append BEFORE done so subscribers see the row by the time the
        // client receives the done event.
        const op: StudioOp = {
          id: opId,
          ts: Date.now(),
          op: "promote",
          skillId: `${plugin}/${skill}`,
          fromScope,
          toScope: "own",
          paths: { source: sourcePath, dest: result.destPath },
          actor: "studio-ui",
          details: { filesWritten: result.filesWritten },
        };
        await appendOp(op);

        sendSSEDone(res, { type: "done", opId, destPath: result.destPath });
      } catch (err) {
        if (err instanceof CollisionError) {
          // 409 — JSON, not SSE (headers not yet sent because emit() defers initSSE
          // until the FIRST event; collision is detected inside transfer() AFTER
          // started has fired, so we may already have SSE headers… handle both).
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
