// ---------------------------------------------------------------------------
// install-jobs — shared spawn-job runtime for install-skill / install-engine
// ---------------------------------------------------------------------------
// Both install-skill-routes and install-engine-routes were ~90% duplicate code:
//   - InstallJob interface (proc, buffers, subscribers, pastEvents)
//   - JOBS Map per route (UUID → job)
//   - localhost-only guard
//   - stdout/stderr ring-buffered into per-line "progress" events
//   - SIGTERM on timeout, "done" event on exit/error
//   - SSE replay-then-subscribe `/:jobId/stream` route
//
// Extracting that here means an SSE / timeout / replay bug fix lands once,
// not twice. Each route file now declares only:
//   - its argv builder + body validation
//   - its prefix and metadata shape (TMeta)
// ---------------------------------------------------------------------------

import * as http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { buildSpawnEnv } from "./utils/spawn-env.js";

export const STDOUT_BUFFER_CAP = 1024 * 1024; // 1 MiB ring per stream.

export type JobEvent = "progress" | "done";

export interface SpawnJob<TMeta extends object> {
  id: string;
  meta: TMeta;
  proc: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  exitCode: number | null;
  done: boolean;
  subscribers: Set<(event: JobEvent, data: unknown) => void>;
  pastEvents: Array<{ event: JobEvent; data: unknown }>;
}

export interface StartSpawnJobOptions<TMeta extends object> {
  command: string;
  args: string[];
  meta: TMeta;
  timeoutMs: number;
  jobs: Map<string, SpawnJob<TMeta>>;
}

export function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export function trimRing(buf: string, cap: number): string {
  return buf.length <= cap ? buf : buf.slice(buf.length - cap);
}

function emitToJob<TMeta extends object>(
  job: SpawnJob<TMeta>,
  event: JobEvent,
  data: unknown,
): void {
  job.pastEvents.push({ event, data });
  for (const sub of job.subscribers) {
    try { sub(event, data); } catch { /* subscriber failed — ignore */ }
  }
}

/**
 * Spawn `command` with `args`, wire stdout/stderr to per-line "progress"
 * events, register the job in `jobs`, and emit "done" on exit / error /
 * timeout. Returns the registered job synchronously so the HTTP handler
 * can reply with `{ jobId }` immediately.
 */
export function startSpawnJob<TMeta extends object>(
  opts: StartSpawnJobOptions<TMeta>,
): SpawnJob<TMeta> {
  const proc = spawn(opts.command, opts.args, {
    stdio: ["ignore", "pipe", "pipe"],
    // Scrub env — provider keys / studio overrides are not needed by the
    // installer command and shouldn't leak to subprocess descendants.
    env: buildSpawnEnv(),
  });

  const job: SpawnJob<TMeta> = {
    id: randomUUID(),
    meta: opts.meta,
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
  }, opts.timeoutMs);

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

  opts.jobs.set(job.id, job);
  return job;
}

/**
 * Mount `GET <prefix>/:jobId/stream` on `router`. The handler enforces the
 * localhost gate, replays buffered events, then subscribes the SSE response
 * to live "progress"/"done" events until disconnect.
 */
export function mountSpawnStreamRoute<TMeta extends object>(
  router: Router,
  prefix: string,
  jobs: Map<string, SpawnJob<TMeta>>,
): void {
  router.get(
    `${prefix}/:jobId/stream`,
    async (req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }
      const job = jobs.get(params.jobId);
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

      const subscriber = (event: JobEvent, data: unknown) => {
        try {
          if (event === "done") sendSSEDone(res, data);
          else sendSSE(res, event, data);
        } catch {
          // Stream write failed — eagerly drop this subscriber so we don't
          // accumulate dead listeners on half-open sockets.
          job.subscribers.delete(subscriber);
        }
      };
      job.subscribers.add(subscriber);

      const cleanup = () => { job.subscribers.delete(subscriber); };
      req.on("close", cleanup);
      req.on("aborted", cleanup);
    },
  );
}
