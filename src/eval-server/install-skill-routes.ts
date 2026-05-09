// 0784 hotfix — local install of arbitrary skills via the eval-server.
//
// Mirrors the install-engine-routes pattern (localhost-only, SSE progress
// stream, hard-coded command name, no shell) but accepts an arbitrary skill
// identifier validated by the same SAFE_NAME regex used in SkillDetailPanel.
//
// Security model:
//   1. Localhost-only — req.socket.remoteAddress must be 127.0.0.1 / ::1.
//   2. SAFE_NAME regex — skill identifier MUST match /^[a-zA-Z0-9._@/\-]+$/
//      (same as SkillDetailPanel sanitizer). The validated string is passed
//      as a single argv entry to spawn("vskill", [...]) — never a shell.
//   3. Scope allowlist — "project" | "user" | "global" only.
//   4. Hard-coded command name "vskill" — no path injection.
//
// Endpoints:
//   POST /api/studio/install-skill        { skill, scope } → 202 + { jobId }
//   GET  /api/studio/install-skill/:id/stream             SSE progress | done

import * as http from "node:http";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import {
  isLocalhost,
  mountSpawnStreamRoute,
  startSpawnJob,
  type SpawnJob,
} from "./install-jobs.js";

type InstallScope = "project" | "user" | "global";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(["project", "user", "global"]);
const INSTALL_TIMEOUT_MS = 180_000; // 3 min — installs can be slow on cold caches.

interface SkillJobMeta {
  skill: string;
  scope: InstallScope;
}

const JOBS = new Map<string, SpawnJob<SkillJobMeta>>();

function buildArgs(skill: string, scope: InstallScope): string[] {
  // No shell — every entry is a discrete argv element. Scope is from a
  // closed set; skill is regex-validated. Both flags map to vskill CLI.
  if (scope === "global") return ["install", skill, "--global"];
  return ["install", skill, "--scope", scope];
}

export function registerInstallSkillRoutes(router: Router): void {
  // POST /api/studio/install-skill { skill, scope } → 202 { jobId }
  router.post(
    "/api/studio/install-skill",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const body = (await readBody(req)) as { skill?: string; scope?: string };
      const skill = typeof body?.skill === "string" ? body.skill.trim() : "";
      const scope = typeof body?.scope === "string" ? body.scope : "";
      if (!skill || !SAFE_NAME.test(skill)) {
        sendJson(res, { error: "invalid skill identifier" }, 400, req);
        return;
      }
      if (!VALID_SCOPES.has(scope)) {
        sendJson(res, { error: "invalid scope (must be project|user|global)" }, 400, req);
        return;
      }
      const job = startSpawnJob<SkillJobMeta>({
        command: "vskill",
        args: buildArgs(skill, scope as InstallScope),
        meta: { skill, scope: scope as InstallScope },
        timeoutMs: INSTALL_TIMEOUT_MS,
        jobs: JOBS,
      });
      sendJson(res, { jobId: job.id }, 202, req);
    },
  );

  // GET /api/studio/install-skill/:jobId/stream
  mountSpawnStreamRoute(router, "/api/studio/install-skill", JOBS);
}

export const __test__ = { JOBS, SAFE_NAME, VALID_SCOPES, INSTALL_TIMEOUT_MS, buildArgs };
