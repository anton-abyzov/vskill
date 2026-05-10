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
import { sendJson, readBody } from "./router.js";

// 0836 US-002: the studio-token gate is now the primary authn for /api/*.
// Origin-pattern matching kept as defense-in-depth for git-routes (CSRF
// guard against browser cross-site requests with the token leaking via
// devtools / extension). The pattern was previously exported from router.ts
// as LOCALHOST_ORIGIN_RE — inlined here as the only remaining caller.
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
import { createLlmClient, type ProviderName } from "../eval/llm.js";

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
// Diff + dirty-state helpers (Phase 5).
//
// `git status --porcelain` is the canonical "is the tree dirty?" check —
// any non-empty output means there are tracked changes (staged, unstaged,
// or untracked). We combine `git diff --staged` + `git diff` for the
// payload sent to the LLM so it sees both already-staged and unstaged work.
// ---------------------------------------------------------------------------

interface DiffSummary {
  hasChanges: boolean;
  diff: string;
  fileCount: number;
}

async function collectDiffSummary(root: string, timeoutMs: number): Promise<DiffSummary> {
  const [staged, unstaged, status] = await Promise.all([
    runGitCommand(["diff", "--staged"], root, timeoutMs),
    runGitCommand(["diff"], root, timeoutMs),
    runGitCommand(["status", "--porcelain"], root, timeoutMs),
  ]);
  const stagedText = staged.exitCode === 0 ? staged.stdout : "";
  const unstagedText = unstaged.exitCode === 0 ? unstaged.stdout : "";
  const diff = [stagedText, unstagedText].filter(Boolean).join("\n");
  const statusText = status.exitCode === 0 ? status.stdout : "";
  const fileCount = statusText
    .split("\n")
    .filter((l) => l.trim().length > 0).length;
  return { hasChanges: fileCount > 0, diff, fileCount };
}

// ---------------------------------------------------------------------------
// GET /api/git/status
//
// Lightweight `git status --porcelain` probe used by the sidebar to highlight
// skills with uncommitted changes. Returns ONLY the file paths (porcelain
// status prefix stripped) so the UI can resolve dirty paths to skills via
// `getDirtySkillIds(skills, paths, root)`. Cheap enough to poll on a 5-10s
// interval. Non-git workspaces (or git error) → `{ paths: [] }`, never 5xx.
// ---------------------------------------------------------------------------

const PORCELAIN_PREFIX_RE = /^[ MADRCU?!]{1,2} +/;

export function makeGetGitStatusHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const result = await runGitCommand(["status", "--porcelain"], root, getTimeoutMs());
    if (result.exitCode !== 0) {
      // Not a git repo / detached / network — fail soft so the UI just shows
      // an empty dirty set without bothering the user.
      sendJson(res, { paths: [] }, 200);
      return;
    }
    const paths = result.stdout
      .split("\n")
      .map((line) => line.replace(PORCELAIN_PREFIX_RE, "").trim())
      .filter((p) => p.length > 0);
    sendJson(res, { paths }, 200);
  };
}

// ---------------------------------------------------------------------------
// POST /api/git/diff
//
// Returns the combined staged + unstaged diff plus a dirty/file-count summary.
// The UI calls this when the user clicks Publish to decide whether to open
// the commit-message drawer (dirty) or just push (clean).
// ---------------------------------------------------------------------------
export function makePostGitDiffHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const summary = await collectDiffSummary(root, getTimeoutMs());
    sendJson(res, summary, 200);
  };
}

// ---------------------------------------------------------------------------
// POST /api/git/commit-message
//
// Body: `{ provider?: ProviderName, model?: string }` — reuses the user's
// already-configured studio provider (same one used by AI Edit, Improve,
// Generate). Runs git diff, sends the patch to the LLM, returns the message.
// Returns 400 when there are no changes, 500 on LLM error.
// ---------------------------------------------------------------------------

const COMMIT_MESSAGE_SYSTEM_PROMPT =
  "You write concise, conventional-commit-style git commit messages. " +
  "Output ONLY the commit message itself — no quotes, no markdown, no preamble. " +
  "Format: a single subject line under 72 chars, optionally followed by a blank " +
  "line and a body wrapped at 72 chars. Use lowercase type prefix when applicable " +
  "(feat:, fix:, refactor:, docs:, test:, chore:). Be specific about what changed " +
  "and why, but stay terse.";

const DIFF_TRUNCATION_CAP = 10_000;

export function makePostGitCommitMessageHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }

    let body: { provider?: ProviderName; model?: string };
    try {
      body = (await readBody(req)) as { provider?: ProviderName; model?: string };
    } catch (err) {
      sendJson(res, { error: err instanceof Error ? err.message : "invalid body" }, 400);
      return;
    }

    const summary = await collectDiffSummary(root, getTimeoutMs());
    if (!summary.hasChanges) {
      sendJson(res, { error: "no changes to commit", hasChanges: false }, 400);
      return;
    }

    // Cap diff size so we don't blow context windows / pricing on huge patches.
    let payload = summary.diff;
    let truncated = false;
    if (payload.length > DIFF_TRUNCATION_CAP) {
      payload = payload.slice(0, DIFF_TRUNCATION_CAP);
      truncated = true;
    }

    const userPrompt =
      `Generate a commit message for the following diff` +
      (truncated ? ` (truncated to first ${DIFF_TRUNCATION_CAP} chars of a larger patch)` : "") +
      `:\n\n${payload}`;

    try {
      const client = createLlmClient({ provider: body.provider, model: body.model });
      const result = await client.generate(COMMIT_MESSAGE_SYSTEM_PROMPT, userPrompt);
      sendJson(res, { message: result.text.trim() }, 200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson(res, { error: msg }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// POST /api/git/publish
//
// Pushes already-committed changes. When body.commitMessage is provided AND
// the working tree is dirty, also runs `git add -A && git commit -m "<msg>"`
// before push. The full 0742 increment may layer dirty-pill, SSE streaming,
// and gh-CLI repo creation on top.
// ---------------------------------------------------------------------------
export function makePostGitPublishHandler(root: string) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      const msg = "forbidden: publish only allowed from loopback";
      sendJson(res, { success: false, error: msg, stderr: msg }, 403);
      return;
    }

    let body: { commitMessage?: string } = {};
    try {
      body = (await readBody(req)) as { commitMessage?: string };
    } catch {
      // Empty body / malformed body — fall back to "no commit" mode (today's
      // happy path). We don't fail loudly here because the original 0759
      // contract accepted no body at all.
    }

    const timeout = getTimeoutMs();

    // Optional commit phase. We only commit when the caller supplied a message
    // AND there's something to commit. A clean tree with a stray message is a
    // no-op (we still push, in case there are unpushed commits).
    if (typeof body.commitMessage === "string" && body.commitMessage.trim().length > 0) {
      const status = await runGitCommand(["status", "--porcelain"], root, timeout);
      const dirty = status.exitCode === 0 && status.stdout.trim().length > 0;
      if (dirty) {
        const add = await runGitCommand(["add", "-A"], root, timeout);
        if (add.exitCode !== 0) {
          const errorMsg = (add.stderr || add.stdout).trim() || "git add failed";
          sendJson(res, { success: false, error: errorMsg, stdout: add.stdout, stderr: add.stderr }, 500);
          return;
        }
        const commit = await runGitCommand(
          ["commit", "-m", body.commitMessage],
          root,
          timeout,
        );
        if (commit.exitCode !== 0) {
          const errorMsg = (commit.stderr || commit.stdout).trim() || "git commit failed";
          sendJson(res, { success: false, error: errorMsg, stdout: commit.stdout, stderr: commit.stderr }, 500);
          return;
        }
      }
    }

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

  const statusHandler = makeGetGitStatusHandler(root);
  router.get("/api/git/status", (req, res) => statusHandler(req, res));

  const diffHandler = makePostGitDiffHandler(root);
  router.post("/api/git/diff", (req, res) => diffHandler(req, res));

  const commitMessageHandler = makePostGitCommitMessageHandler(root);
  router.post("/api/git/commit-message", (req, res) => commitMessageHandler(req, res));

  const publishHandler = makePostGitPublishHandler(root);
  router.post("/api/git/publish", (req, res) => publishHandler(req, res));
}
