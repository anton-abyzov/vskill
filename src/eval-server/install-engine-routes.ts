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
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { isCliAvailable } from "./install-engine-routes-helpers.js";

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
const STDOUT_BUFFER_CAP = 1024 * 1024; // 1 MB

interface InstallJob {
  id: string;
  engine: EngineName;
  proc: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  exitCode: number | null;
  done: boolean;
  /** Listeners that receive progress events as they arrive. */
  subscribers: Set<(event: "progress" | "done", data: unknown) => void>;
  /** Replay log so a stream that connects after spawn started gets prior events. */
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

function startInstall(engine: EngineName): InstallJob {
  const cmd = INSTALL_COMMANDS[engine];
  const proc = spawn(cmd.command, cmd.args, { stdio: ["ignore", "pipe", "pipe"] });
  const job: InstallJob = {
    id: randomUUID(),
    engine,
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

      const job = startInstall(engine);
      sendJson(res, { jobId: job.id }, 202, req);
    },
  );

  // GET /api/studio/install-engine/:jobId/stream
  router.get(
    "/api/studio/install-engine/:jobId/stream",
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

      // Replay any events that fired before this stream connected.
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

      const cleanup = () => {
        job.subscribers.delete(subscriber);
      };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    },
  );
}

// ---------------------------------------------------------------------------
// Internals exposed for tests.
// ---------------------------------------------------------------------------
export const __test__ = {
  INSTALL_COMMANDS,
  INSTALL_TIMEOUT_MS,
  jobs: JOBS,
};
