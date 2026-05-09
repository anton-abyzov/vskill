// ---------------------------------------------------------------------------
// revert route — POST /api/skills/:plugin/:skill/revert
// ---------------------------------------------------------------------------
// AC-US3-01 (SSE started → deleted → indexed → done; OWN dir removed)
// AC-US3-03/04 (provenance-gated delete — missing .vskill-meta.json → 400
//                {code:"no-provenance"}, no fs change; the original promote
//                op in ops-log is preserved — a new revert op is appended)
//
// Semantics: revert is mechanically an OWN-only delete. The SSE `destPath` /
// op-log `paths.dest` carry `provenance.sourcePath` as the LOGICAL target
// (where the skill should reappear once OWN is removed and the underlying
// installed/global scope becomes visible again). If that source has been
// uninstalled or modified between promote and revert, the user ends up with
// no skill at all — we record `sourceExists` in the op-log details so an
// audit can detect this case post-hoc.
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, rmSync } from "node:fs";

import type { Router } from "../../eval-server/router.js";
import { sendJson } from "../../eval-server/router.js";
import { initSSE, sendSSE, sendSSEDone } from "../../eval-server/sse-helpers.js";
import { countFiles, resolveScopePath } from "../lib/scope-transfer.js";
import { readProvenance } from "../lib/provenance.js";
import { appendOp } from "../lib/ops-log.js";
import type { StudioOp, TransferEvent } from "../types.js";

export function registerRevertRoute(
  router: Router,
  root: string,
  home: string = homedir(),
): void {
  router.post(
    "/api/skills/:plugin/:skill/revert",
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      const { plugin, skill } = params;
      const ownDir = resolveScopePath("own", root, skill, home);
      const opId = randomUUID();

      if (!existsSync(ownDir)) {
        sendJson(res, { ok: false, code: "missing-source", path: ownDir }, 404, req);
        return;
      }

      // Provenance gate (AC-US3-04) — refuse to delete a skill that was NOT
      // promoted, since that would destroy user-authored work.
      const provenance = await readProvenance(ownDir);
      if (!provenance) {
        sendJson(res, { ok: false, code: "no-provenance", path: ownDir }, 400, req);
        return;
      }

      const emit = (e: TransferEvent) => {
        if (!res.headersSent) initSSE(res, req);
        sendSSE(res, e.type, e);
      };

      try {
        // Capture target scope for logging BEFORE the delete.
        const toScope = provenance.promotedFrom;
        const filesDeleted = countFiles(ownDir);
        // Record whether the logical reveal target still exists on disk.
        // False = revert leaves the user with no copy of the skill anywhere.
        const sourceExists = existsSync(provenance.sourcePath);

        emit({
          type: "started",
          opId,
          skillId: `${plugin}/${skill}`,
          fromScope: "own",
          toScope,
          sourcePath: ownDir,
          destPath: provenance.sourcePath,
        });

        rmSync(ownDir, { recursive: true, force: true });

        emit({ type: "deleted", filesDeleted });
        emit({ type: "indexed" });

        // Append-only: a NEW revert op is appended. We do NOT mutate the
        // original promote op.
        const op: StudioOp = {
          id: opId,
          ts: Date.now(),
          op: "revert",
          skillId: `${plugin}/${skill}`,
          fromScope: "own",
          toScope,
          paths: { source: ownDir, dest: provenance.sourcePath },
          actor: "studio-ui",
          details: { filesDeleted, sourceExists },
        };
        await appendOp(op);

        sendSSEDone(res, { type: "done", opId, destPath: ownDir });
      } catch (err) {
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
