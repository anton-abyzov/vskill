// ---------------------------------------------------------------------------
// 0759 — git routes: minimum-viable publish flow.
//
// GET  /api/git/remote   → { remoteUrl, branch, hasRemote }
// POST /api/git/publish  → { success, commitSha, branch, remoteUrl, stdout, stderr }
//
// Both handlers spawn real `git` subprocesses with an explicit argv array
// (NOT shell-string interpolation, NOT exec) and a configurable timeout.
// The 0742 full-publish increment will layer dirty-pill, AI commit messages,
// and gh-CLI-based repo creation on top of these primitives.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import type { Router } from "./router.js";
import { sendJson, LOCALHOST_ORIGIN_RE } from "./router.js";

interface GitResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function getTimeoutMs(): number {
  const raw = process.env.GIT_PUBLISH_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

// argv-only spawn helper. Never accepts a single command string and never
// passes shell:true — both are documented shell-injection vectors.
function runGitCommand(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<GitResult> {
  return new Promise((resolve) => {
    const proc = spawn("git", args as string[], { cwd });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve({ exitCode: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut: false });
    });
    proc.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr || err.message,
        timedOut: false,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Request guards
// ---------------------------------------------------------------------------

// Defense-in-depth: reject requests from non-loopback addresses.
// eval-server binds to 127.0.0.1 by design, but guard explicitly in case a
// proxy or misconfiguration exposes the port externally.
function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// CSRF guard: reject requests whose Origin header is set but does NOT match a
// localhost/loopback pattern. Browser-originated cross-site requests (from a
// drive-by page) always include Origin; absent-Origin is allowed for
// non-browser clients (curl, tests), which cannot be CSRF-attacked.
function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers["origin"];
  if (!origin) return true; // no origin → not a browser cross-site request
  return LOCALHOST_ORIGIN_RE.test(origin);
}

function isRequestAllowed(req: IncomingMessage): boolean {
  return isLoopback(req.socket?.remoteAddress) && isOriginAllowed(req);
}

// ---------------------------------------------------------------------------
// GET /api/git/remote
// ---------------------------------------------------------------------------
export function makeGetGitRemoteHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const timeout = getTimeoutMs();
    const [remote, branchResult] = await Promise.all([
      runGitCommand(["remote", "get-url", "origin"], root, timeout),
      runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], root, timeout),
    ]);

    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;

    if (remote.exitCode !== 0) {
      sendJson(res, { remoteUrl: null, branch, hasRemote: false }, 200);
      return;
    }

    const remoteUrl = remote.stdout.trim();
    sendJson(res, { remoteUrl, branch, hasRemote: remoteUrl.length > 0 }, 200);
  };
}

// ---------------------------------------------------------------------------
// POST /api/git/publish
//
// Pushes already-committed changes (no commit composition in this MVP — the
// full 0742 increment will add AI commit messages and dirty-state composition).
// On success, also collects HEAD SHA, remote URL, and current branch so the
// UI can construct the verified-skill.com submit URL.
// ---------------------------------------------------------------------------
export function makePostGitPublishHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      const msg = "forbidden: publish only allowed from loopback";
      sendJson(res, { success: false, error: msg, stderr: msg }, 403);
      return;
    }

    const timeout = getTimeoutMs();

    const push = await runGitCommand(["push"], root, timeout);

    if (push.timedOut) {
      const timeoutMsg = "timeout: git push exceeded GIT_PUBLISH_TIMEOUT_MS";
      sendJson(
        res,
        { success: false, error: timeoutMsg, stdout: push.stdout, stderr: timeoutMsg },
        500,
      );
      return;
    }
    if (push.exitCode !== 0) {
      // `error` is read by fetchJson on the UI side to surface a human-readable
      // message in the error toast. Prefer stderr (git push writes there on
      // failure); fall back to stdout in case stderr is empty.
      const errorMsg = (push.stderr || push.stdout).trim();
      sendJson(res, { success: false, error: errorMsg, stdout: push.stdout, stderr: push.stderr }, 500);
      return;
    }

    // Collect metadata for the UI's success toast + URL construction in
    // parallel. These are best-effort; if any fail, we still report success.
    const [sha, remote, branchResult] = await Promise.all([
      runGitCommand(["rev-parse", "HEAD"], root, timeout),
      runGitCommand(["remote", "get-url", "origin"], root, timeout),
      runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], root, timeout),
    ]);

    sendJson(
      res,
      {
        success: true,
        commitSha: sha.exitCode === 0 ? sha.stdout.trim() : null,
        branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : null,
        remoteUrl: remote.exitCode === 0 ? remote.stdout.trim() : null,
        stdout: push.stdout,
        stderr: push.stderr,
      },
      200,
    );
  };
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
export function registerGitRoutes(router: Router, root: string): void {
  const remoteHandler = makeGetGitRemoteHandler(root);
  router.get("/api/git/remote", (req, res) => remoteHandler(req, res));

  const publishHandler = makePostGitPublishHandler(root);
  router.post("/api/git/publish", (req, res) => publishHandler(req, res));
}
