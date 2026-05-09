// ---------------------------------------------------------------------------
// Studio install-engine routes — POST /api/studio/install-engine + SSE stream.
// ---------------------------------------------------------------------------
//
// Lets the Studio Create-Skill UI install a missing authoring engine without
// dropping the user into a terminal. Two endpoints:
//
//   POST /api/studio/install-engine        { engine } → 202 + { jobId }
//   GET  /api/studio/install-engine/:id/stream        SSE: progress | done
//
// Security model (defense-in-depth, see ADR 0734-01):
//   1. Hard-coded engine→command allow-list — no request data ever reaches a
//      shell. The body's `engine` field is enum-validated against the allow-
//      list keys; the spawned argv is read from a constant.
//   2. Localhost-only guard — req.socket.remoteAddress must be 127.0.0.1 / ::1.
//      eval-server already binds loopback by default; this is belt-and-
//      suspenders against accidental config exposure.
//   3. Confirm-before-run is enforced UX-side in InstallEngineModal — no
//      server-side trust of the client to gate install.
//
// Ref: .specweave/increments/0734-studio-create-skill-engine-selector
// ACs: AC-US5-01..AC-US5-09
// ---------------------------------------------------------------------------

import * as http from "node:http";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { isCliAvailable } from "./install-engine-routes-helpers.js";
import {
  isLocalhost,
  mountSpawnStreamRoute,
  startSpawnJob,
  type SpawnJob,
} from "./install-jobs.js";

type EngineName = "vskill" | "anthropic-skill-creator";

interface EngineCommand {
  command: string;
  args: string[];
  /** PATH-resolved CLI that MUST exist before we spawn `command`. */
  prerequisite: string;
}

/**
 * Hard-coded engine→command allow-list. The HTTP request body NEVER reaches a
 * shell — only the engine *name* is read from the request, then mapped here.
 */
const INSTALL_COMMANDS: Record<EngineName, EngineCommand> = {
  "anthropic-skill-creator": {
    command: "claude",
    args: ["plugin", "install", "skill-creator"],
    prerequisite: "claude",
  },
  vskill: {
    command: "vskill",
    args: ["install", "anton-abyzov/vskill/skill-builder"],
    prerequisite: "vskill",
  },
};

const INSTALL_TIMEOUT_MS = 120_000;

interface EngineJobMeta {
  engine: EngineName;
}

const JOBS = new Map<string, SpawnJob<EngineJobMeta>>();

export function registerInstallEngineRoutes(router: Router, _root: string): void {
  // POST /api/studio/install-engine
  router.post(
    "/api/studio/install-engine",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }

      const body = (await readBody(req)) as { engine?: string };
      const engine = body?.engine;

      if (engine !== "vskill" && engine !== "anthropic-skill-creator") {
        sendJson(res, {
          error: "Invalid engine. Must be one of: vskill, anthropic-skill-creator.",
        }, 400, req);
        return;
      }

      const cmd = INSTALL_COMMANDS[engine];
      if (!isCliAvailable(cmd.prerequisite)) {
        if (engine === "anthropic-skill-creator") {
          sendJson(res, {
            error: "claude-cli-missing",
            remediation: "Install Claude Code CLI first: https://docs.claude.com/claude-code",
          }, 412, req);
          return;
        }
        sendJson(res, {
          error: `${cmd.prerequisite}-cli-missing`,
          remediation: `Install ${cmd.prerequisite} CLI first.`,
        }, 412, req);
        return;
      }

      const job = startSpawnJob<EngineJobMeta>({
        command: cmd.command,
        args: cmd.args,
        meta: { engine },
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobs: JOBS,
      });
      sendJson(res, { jobId: job.id }, 202, req);
    },
  );

  // GET /api/studio/install-engine/:jobId/stream
  mountSpawnStreamRoute(router, "/api/studio/install-engine", JOBS);
}

// ---------------------------------------------------------------------------
// Internals exposed for tests.
// ---------------------------------------------------------------------------
export const __test__ = {
  INSTALL_COMMANDS,
  INSTALL_TIMEOUT_MS,
  jobs: JOBS,
};
