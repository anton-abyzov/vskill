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
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";

type InstallScope = "project" | "user" | "global";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;
const VALID_SCOPES: ReadonlySet<string> = new Set(["project", "user", "global"]);
const INSTALL_TIMEOUT_MS = 180_000; // 3 min — installs can be slow on cold caches.
const STDOUT_BUFFER_CAP = 1024 * 1024;

interface InstallJob {
  id: string;
  skill: string;
  scope: InstallScope;
  proc: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  exitCode: number | null;
  done: boolean;
  subscribers: Set<(event: "progress" | "done", data: unknown) => void>;
  pastEvents: Array<{ event: "progress" | "done"; data: unknown }>;
}

const JOBS = new Map<string, InstallJob>();

function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function trimRing(buf: string, cap: number): string {
  return buf.length <= cap ? buf : buf.slice(buf.length - cap);
}

function emitToJob(job: InstallJob, event: "progress" | "done", data: unknown): void {
  job.pastEvents.push({ event, data });
  for (const sub of job.subscribers) {
    try { sub(event, data); } catch { /* subscriber failed — ignore */ }
  }
}

function buildArgs(skill: string, scope: InstallScope): string[] {
  // No shell — every entry is a discrete argv element. Scope is from a
  // closed set; skill is regex-validated. Both flags map to vskill CLI.
  if (scope === "global") return ["install", skill, "--global"];
  return ["install", skill, "--scope", scope];
}

function startInstall(skill: string, scope: InstallScope): InstallJob {
  const args = buildArgs(skill, scope);
  const proc = spawn("vskill", args, { stdio: ["ignore", "pipe", "pipe"] });

  const job: InstallJob = {
    id: randomUUID(),
    skill,
    scope,
    proc,
    stdoutBuffer: "",
    stderrBuffer: "",
    exitCode: null,
    done: false,
    subscribers: new Set(),
    pastEvents: [],
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    job.stdoutBuffer = trimRing(job.stdoutBuffer + text, STDOUT_BUFFER_CAP);
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) emitToJob(job, "progress", { stream: "stdout", line });
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    job.stderrBuffer = trimRing(job.stderrBuffer + text, STDOUT_BUFFER_CAP);
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0) emitToJob(job, "progress", { stream: "stderr", line });
    }
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill("SIGTERM"); } catch { /* process already gone */ }
  }, INSTALL_TIMEOUT_MS);

  proc.on("exit", (code) => {
    clearTimeout(timer);
    job.exitCode = timedOut ? -1 : code;
    job.done = true;
    const stderr = timedOut ? "timeout" : job.stderrBuffer.trim();
    emitToJob(job, "done", {
      success: !timedOut && code === 0,
      exitCode: timedOut ? -1 : code,
      stderr,
    });
  });

  proc.on("error", (err) => {
    clearTimeout(timer);
    job.exitCode = -1;
    job.done = true;
    emitToJob(job, "done", {
      success: false,
      exitCode: -1,
      stderr: (err as Error).message || "spawn failed",
    });
  });

  JOBS.set(job.id, job);
  return job;
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
      const job = startInstall(skill, scope as InstallScope);
      sendJson(res, { jobId: job.id }, 202, req);
    },
  );

  // GET /api/studio/install-skill/:jobId/stream — SSE
  router.get(
    "/api/studio/install-skill/:jobId/stream",
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const job = JOBS.get(params.jobId);
      if (!job) {
        sendJson(res, { error: "unknown jobId" }, 404, req);
        return;
      }
      initSSE(res, req);
      for (const ev of job.pastEvents) {
        try { sendSSE(res, ev.event, ev.data); } catch { /* stream closed */ }
      }
      if (job.done) {
        try { res.end(); } catch { /* already closed */ }
        return;
      }
      const subscriber = (event: "progress" | "done", data: unknown) => {
        try {
          if (event === "done") sendSSEDone(res, data);
          else sendSSE(res, event, data);
        } catch { /* stream closed */ }
      };
      job.subscribers.add(subscriber);
      const cleanup = () => { job.subscribers.delete(subscriber); };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    },
  );
}

export const __test__ = { JOBS, SAFE_NAME, VALID_SCOPES, INSTALL_TIMEOUT_MS, buildArgs };
