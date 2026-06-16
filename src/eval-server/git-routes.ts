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
import { existsSync } from "node:fs";
import { isAbsolute, join, dirname } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";

// 0836 US-002: the studio-token gate is now the primary authn for /api/*.
// Origin-pattern matching kept as defense-in-depth for git-routes (CSRF
// guard against browser cross-site requests with the token leaking via
// devtools / extension). The pattern was previously exported from router.ts
// as LOCALHOST_ORIGIN_RE — inlined here as the only remaining caller.
const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
import { createLlmClient, type ProviderName } from "../eval/llm.js";
import { enhancedSpawnEnv } from "../utils/resolve-binary.js";

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
    // enhancedSpawnEnv() restores a full PATH so git AND its hooks (notably the
    // Git-LFS `pre-push` hook shelling out to `git-lfs`) resolve even when the
    // studio process was Dock/Spotlight-launched with a truncated PATH.
    //
    // GIT_TERMINAL_PROMPT=0 — this is a headless server context with no TTY, so
    // a credentials-required push/pull (incl. the 0875 auto-reconcile
    // pull --rebase / retry push) must FAIL FAST instead of blocking the whole
    // GIT_PUBLISH_TIMEOUT_MS window on an invisible interactive prompt.
    const proc = spawn("git", args as string[], {
      cwd,
      env: { ...enhancedSpawnEnv(), GIT_TERMINAL_PROMPT: "0" },
    });
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
export function makeGetGitRemoteHandler(rootArg: string | (() => string)) {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const root = getRoot();
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

export function makeGetGitStatusHandler(rootArg: string | (() => string)) {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const root = getRoot();
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
export function makePostGitDiffHandler(rootArg: string | (() => string)) {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const root = getRoot();
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

export function makePostGitCommitMessageHandler(rootArg: string | (() => string)) {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const root = getRoot();
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
export function makePostGitPublishHandler(rootArg: string | (() => string)) {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const root = getRoot();
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

    // 0875 — mid-rebase pre-flight guard. If a PREVIOUS auto-reconcile left the
    // repo mid-rebase (e.g. a `git rebase --abort` that itself failed), running
    // `git add -A && git commit` here would commit onto an interrupted-rebase
    // tree and make things worse. Detect that state up front and bail with a
    // clear, actionable message instead.
    if (await isMidRebase(root, timeout)) {
      const msg =
        "A previous publish left this repository mid-rebase. Run `git rebase --abort` " +
        "(or finish the rebase) in the skill folder, then publish again.";
      sendJson(res, { success: false, error: msg, stderr: msg, reason: "mid_rebase" }, 409);
      return;
    }

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

    let push = await runGitCommand(["push"], root, timeout);

    if (push.timedOut) {
      const timeoutMsg = "timeout: git push exceeded GIT_PUBLISH_TIMEOUT_MS";
      sendJson(
        res,
        { success: false, error: timeoutMsg, stdout: push.stdout, stderr: timeoutMsg },
        500,
      );
      return;
    }

    // 0875 — auto-reconcile a non-fast-forward rejection. When origin/<branch>
    // has moved ahead, `git push` aborts with a "non-fast-forward" / "[rejected]"
    // / "fetch first" / "Updates were rejected" message and the user is stuck.
    // Instead of dumping that raw stderr, pull --rebase --autostash and retry the
    // push so a clean, conflict-free divergence resolves transparently.
    let reconciled = false;
    if (push.exitCode !== 0 && isNonFastForward(push)) {
      const branchProbe = await runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], root, timeout);
      const branch = branchProbe.exitCode === 0 ? branchProbe.stdout.trim() : "";
      if (branch && branch !== "HEAD") {
        const pull = await runGitCommand(
          ["pull", "--rebase", "--autostash", "origin", branch],
          root,
          timeout,
        );
        if (pull.exitCode === 0) {
          // Rebase landed cleanly — retry the push. If it still fails we fall
          // through to the generic error handler below with the retry's output.
          push = await runGitCommand(["push"], root, timeout);
          if (push.timedOut) {
            // Mirror the first-push timeout handling — a bare fall-through would
            // hit the generic handler with an empty `error` and surface a
            // detail-less "Publish failed." in the UI.
            const timeoutMsg = "timeout: git push (retry after rebase) exceeded GIT_PUBLISH_TIMEOUT_MS";
            sendJson(
              res,
              { success: false, error: timeoutMsg, stdout: push.stdout, stderr: timeoutMsg },
              500,
            );
            return;
          }
          if (push.exitCode === 0) reconciled = true;
        } else {
          // Rebase conflicted (or otherwise failed). Collect the conflicted
          // paths BEFORE aborting (abort wipes the conflict state), then run
          // `git rebase --abort` to restore a clean working tree.
          const conflictedProbe = await runGitCommand(
            ["diff", "--name-only", "--diff-filter=U"],
            root,
            timeout,
          );
          const conflictedFiles = conflictedProbe.exitCode === 0
            ? conflictedProbe.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
            : parseConflictFilesFromPull(pull.stdout);
          const abort = await runGitCommand(["rebase", "--abort"], root, timeout);
          // If the abort itself failed, the repo is left mid-rebase — the next
          // publish would re-enter auto-reconcile against a dirty state. Say so
          // explicitly instead of silently swallowing the abort failure.
          const abortNote = abort.exitCode !== 0
            ? " (warning: `git rebase --abort` also failed — your working tree may be mid-rebase; " +
              "run `git rebase --abort` manually before publishing again)"
            : "";
          // Distinguish a true content conflict from a non-conflict pull failure
          // (autostash / network / auth). Only the former is a "rebase_conflict";
          // the latter gets a generic reason so the message isn't misleading.
          const isContentConflict = conflictedFiles.length > 0;
          const fileList = isContentConflict ? conflictedFiles.join(", ") : "the remote branch";
          const error = isContentConflict
            ? `Remote has changes that conflict with yours in: ${fileList}. ` +
              "Pull and resolve manually, then publish again." + abortNote
            : "Could not rebase onto the remote (no conflicting files detected — " +
              "this may be a network, auth, or autostash problem). " +
              "Pull manually and try again." + abortNote;
          sendJson(
            res,
            {
              success: false,
              conflict: true,
              reason: isContentConflict ? "rebase_conflict" : "rebase_failed",
              conflictedFiles,
              error,
              stdout: pull.stdout,
              stderr: pull.stderr,
            },
            200,
          );
          return;
        }
      }
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
        // 0875 — set only when a non-fast-forward push was rebased + retried so
        // the UI can note "reconciled with remote". Absent on the clean path.
        ...(reconciled ? { reconciled: true } : {}),
        stdout: push.stdout,
        stderr: push.stderr,
      },
      200,
    );
  };
}

// 0875 — a non-fast-forward push rejection. git writes the marker to stderr on
// push, but we also scan stdout for robustness across git versions/locales.
const NON_FAST_FORWARD_RE = /non-fast-forward|\[rejected\]|fetch first|Updates were rejected/i;
function isNonFastForward(push: GitResult): boolean {
  return NON_FAST_FORWARD_RE.test(`${push.stderr}\n${push.stdout}`);
}

// Fallback conflict-file extraction from `git pull --rebase` output when the
// `git diff --diff-filter=U` probe is unavailable. Parses "CONFLICT (...): ...
// in <file>" lines that git prints during a failed rebase.
function parseConflictFilesFromPull(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^CONFLICT \([^)]*\):.*?\bin\s+(.+?)\s*$/);
    if (m) files.push(m[1].trim());
  }
  return files;
}

// 0875 — true when the repo is mid-rebase (a `.git/rebase-merge` or
// `.git/rebase-apply` dir exists). Worktree-safe: resolves the git dir once via
// `git rev-parse --git-path` (single spawn), then checks both rebase-state dirs
// with existsSync. Best-effort — on probe failure we assume NOT mid-rebase so we
// never block a legitimate publish on a false positive.
async function isMidRebase(root: string, timeoutMs: number): Promise<boolean> {
  const probe = await runGitCommand(["rev-parse", "--git-path", "rebase-merge"], root, timeoutMs);
  if (probe.exitCode !== 0) return false;
  const rel = probe.stdout.trim();
  if (!rel) return false;
  const rebaseMerge = isAbsolute(rel) ? rel : join(root, rel);
  // `<git-dir>/rebase-merge` (interactive/merge rebase) and the sibling
  // `rebase-apply` (am/--apply rebase) cover both rebase styles.
  const rebaseApply = join(dirname(rebaseMerge), "rebase-apply");
  return existsSync(rebaseMerge) || existsSync(rebaseApply);
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// GET /api/git/repo-info?folder=<absolute-path>
//
// 2026-05-11 — port of the Tauri `get_repo_info` IPC command (which the
// Tauri 2.x ACL silently blocks at runtime; see the tauri-desktop-release
// skill for why). Returns the same shape as the Rust handler so the React
// ConnectedRepoWidget renders identically without further changes.
//
// The shape matches:
//   { name, branch, is_private, sync_state }
//   sync_state.kind ∈ { "no_remote", "dirty", "ahead", "behind", "clean" }
//
// `is_private` is left null on the local side — querying the GitHub API
// would require a token and is best done from the Tauri shell (or a
// future server-side endpoint). The widget treats null as "unknown".
// ---------------------------------------------------------------------------

interface RepoInfo {
  name: string | null;
  branch: string | null;
  is_private: boolean | null;
  sync_state:
    | { kind: "no_remote" }
    | { kind: "dirty"; count: number }
    | { kind: "ahead"; count: number }
    | { kind: "behind"; count: number }
    | { kind: "clean" };
}

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const stripDotGit = (s: string) => s.replace(/\.git$/, "");
  // SSH form: git@github.com:owner/repo(.git)?
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: stripDotGit(sshMatch[2]) };
  // SSH proto form: ssh://git@github.com/owner/repo(.git)?
  const sshProtoMatch = url.match(/^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(\.git)?$/);
  if (sshProtoMatch) return { owner: sshProtoMatch[1], repo: stripDotGit(sshProtoMatch[2]) };
  // HTTPS form: https://github.com/owner/repo(.git)?
  const httpsMatch = url.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: stripDotGit(httpsMatch[2]) };
  return null;
}

export function makeGetRepoInfoHandler() {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isRequestAllowed(req)) {
      sendJson(res, { error: "forbidden" }, 403);
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const folder = url.searchParams.get("folder");
    const empty: RepoInfo = {
      name: null,
      branch: null,
      is_private: null,
      sync_state: { kind: "no_remote" },
    };
    if (!folder) {
      sendJson(res, empty, 200);
      return;
    }
    const timeout = getTimeoutMs();
    // Detect remote URL — `git remote get-url origin` is the canonical form.
    const remote = await runGitCommand(["remote", "get-url", "origin"], folder, timeout);
    if (remote.exitCode !== 0) {
      sendJson(res, empty, 200);
      return;
    }
    const remoteUrl = remote.stdout.trim();
    const parsed = parseGithubUrl(remoteUrl);
    const branchResult = await runGitCommand(["branch", "--show-current"], folder, timeout);
    const branch = branchResult.exitCode === 0
      ? branchResult.stdout.trim() || null
      : null;
    if (!parsed) {
      // Not a github.com remote — return what we have, the widget will
      // render the "external git" empty state.
      sendJson(res, { ...empty, branch }, 200);
      return;
    }
    const name = `${parsed.owner}/${parsed.repo}`;

    // Sync state: upstream → dirty → ahead/behind → clean.
    const upstream = await runGitCommand(["rev-parse", "--abbrev-ref", "@{u}"], folder, timeout);
    let sync_state: RepoInfo["sync_state"] = { kind: "no_remote" };
    if (upstream.exitCode === 0) {
      const porcelain = await runGitCommand(["status", "--porcelain"], folder, timeout);
      const dirty = porcelain.exitCode === 0
        ? porcelain.stdout.split("\n").filter((l) => l.trim().length > 0).length
        : 0;
      if (dirty > 0) {
        sync_state = { kind: "dirty", count: dirty };
      } else {
        const counts = await runGitCommand(
          ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
          folder,
          timeout,
        );
        if (counts.exitCode === 0) {
          const [aheadStr, behindStr] = counts.stdout.trim().split(/\s+/);
          const ahead = parseInt(aheadStr ?? "0", 10) || 0;
          const behind = parseInt(behindStr ?? "0", 10) || 0;
          if (ahead > 0) sync_state = { kind: "ahead", count: ahead };
          else if (behind > 0) sync_state = { kind: "behind", count: behind };
          else sync_state = { kind: "clean" };
        } else {
          sync_state = { kind: "clean" };
        }
      }
    }

    sendJson(res, {
      name,
      branch,
      is_private: null,   // GitHub API call deferred — null = "unknown"
      sync_state,
    } satisfies RepoInfo, 200);
  };
}

export function registerGitRoutes(router: Router, rootArg: string | (() => string)): void {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  const remoteHandler = makeGetGitRemoteHandler(getRoot);
  router.get("/api/git/remote", (req, res) => remoteHandler(req, res));

  const statusHandler = makeGetGitStatusHandler(getRoot);
  router.get("/api/git/status", (req, res) => statusHandler(req, res));

  const diffHandler = makePostGitDiffHandler(getRoot);
  router.post("/api/git/diff", (req, res) => diffHandler(req, res));

  const commitMessageHandler = makePostGitCommitMessageHandler(getRoot);
  router.post("/api/git/commit-message", (req, res) => commitMessageHandler(req, res));

  const publishHandler = makePostGitPublishHandler(getRoot);
  router.post("/api/git/publish", (req, res) => publishHandler(req, res));

  // 2026-05-11 — replaces the blocked Tauri get_repo_info IPC.
  const repoInfoHandler = makeGetRepoInfoHandler();
  router.get("/api/git/repo-info", (req, res) => repoInfoHandler(req, res));
}
