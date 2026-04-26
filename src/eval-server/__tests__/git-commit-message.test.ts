// ---------------------------------------------------------------------------
// 0759 Phase 5 — git-routes commit-message + diff + extended publish tests.
//
// Tests the AI-commit-message follow-up: server runs `git diff --staged` +
// `git diff` to gather changes, sends them to the user-configured LLM
// provider (reuses `createLlmClient` from src/eval/llm.ts), and returns a
// concise commit message. The extended `/api/git/publish` endpoint now
// accepts an optional `commitMessage` — when provided and the workspace is
// dirty, it runs `git add -A && git commit -m "<msg>"` BEFORE `git push`.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Hoisted spawn mock — same pattern as git-routes.test.ts
const { spawnMock, queueProcess } = vi.hoisted(() => {
  type Queued = { stdout: string; stderr: string; exitCode: number | null; delayMs?: number };
  const queue: Queued[] = [];
  const spawnMock = vi.fn((_cmd: string, _args: readonly string[], _opts?: unknown) => {
    const q = queue.shift() ?? { stdout: "", stderr: "", exitCode: 0 };
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => boolean; killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = () => {
      proc.killed = true;
      setImmediate(() => proc.emit("close", null, "SIGTERM"));
      return true;
    };
    const fire = () => {
      if (q.stdout) proc.stdout.emit("data", Buffer.from(q.stdout));
      if (q.stderr) proc.stderr.emit("data", Buffer.from(q.stderr));
      if (q.exitCode !== null) proc.emit("close", q.exitCode, null);
    };
    if (q.delayMs && q.delayMs > 0) setTimeout(fire, q.delayMs);
    else setImmediate(fire);
    return proc;
  });
  return { spawnMock, queueProcess: (q: Queued) => queue.push(q) };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// Hoisted LLM mock so we can drive the generated message + assert call args
const { llmGenerateMock, createLlmClientMock } = vi.hoisted(() => {
  const llmGenerateMock = vi.fn();
  const createLlmClientMock = vi.fn(() => ({
    generate: llmGenerateMock,
    model: "stub-model",
  }));
  return { llmGenerateMock, createLlmClientMock };
});

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: createLlmClientMock,
}));

const { makePostGitDiffHandler, makePostGitCommitMessageHandler, makePostGitPublishHandler } =
  await import("../git-routes.js");

class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  method: string;
  url: string;
  socket: { remoteAddress: string };
  constructor(method: string, url: string, body?: unknown) {
    super();
    this.method = method;
    this.url = url;
    this.socket = { remoteAddress: "127.0.0.1" };
    if (body !== undefined) {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      process.nextTick(() => {
        this.emit("data", Buffer.from(raw));
        this.emit("end");
      });
    } else {
      process.nextTick(() => this.emit("end"));
    }
  }
}

class FakeRes {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = "";
  writeHead(s: number, h?: Record<string, string>) { this.statusCode = s; if (h) Object.assign(this.headers, h); }
  setHeader(k: string, v: string) { this.headers[k] = v; }
  end(d?: string) { if (d !== undefined) this.body += d; }
  get json(): unknown { return JSON.parse(this.body); }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-git-cm-"));
  spawnMock.mockClear();
  llmGenerateMock.mockReset();
  createLlmClientMock.mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// POST /api/git/diff
// ---------------------------------------------------------------------------

describe("POST /api/git/diff", () => {
  it("returns hasChanges=true with combined staged + unstaged diff text", async () => {
    queueProcess({ stdout: "diff --git a/foo.ts b/foo.ts\n+added line\n", stderr: "", exitCode: 0 }); // git diff --staged
    queueProcess({ stdout: "diff --git a/bar.ts b/bar.ts\n+other change\n", stderr: "", exitCode: 0 }); // git diff
    queueProcess({ stdout: "M foo.ts\n M bar.ts\n", stderr: "", exitCode: 0 }); // git status --porcelain

    const h = makePostGitDiffHandler(root);
    const req = new FakeReq("POST", "/api/git/diff", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { hasChanges: boolean; diff: string; fileCount: number };
    expect(body.hasChanges).toBe(true);
    expect(body.diff).toContain("foo.ts");
    expect(body.diff).toContain("bar.ts");
    expect(body.fileCount).toBe(2);
  });

  it("returns hasChanges=false with empty diff when working tree is clean", async () => {
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // git diff --staged
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // git diff
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // git status --porcelain

    const h = makePostGitDiffHandler(root);
    const req = new FakeReq("POST", "/api/git/diff", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { hasChanges: boolean; diff: string; fileCount: number };
    expect(body.hasChanges).toBe(false);
    expect(body.diff).toBe("");
    expect(body.fileCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/git/commit-message
// ---------------------------------------------------------------------------

describe("POST /api/git/commit-message", () => {
  it("calls createLlmClient with the requested provider+model and returns the generated message", async () => {
    queueProcess({ stdout: "diff --git a/foo.ts b/foo.ts\n+x\n", stderr: "", exitCode: 0 }); // staged
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // unstaged
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 }); // status
    llmGenerateMock.mockResolvedValueOnce({
      text: "feat(foo): add x",
      durationMs: 100,
      inputTokens: null,
      outputTokens: null,
      cost: null,
      billingMode: "subscription",
    });

    const h = makePostGitCommitMessageHandler(root);
    const req = new FakeReq("POST", "/api/git/commit-message", {
      provider: "claude-cli",
      model: "sonnet",
    });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { message: string };
    expect(body.message).toBe("feat(foo): add x");
    expect(createLlmClientMock).toHaveBeenCalledWith({ provider: "claude-cli", model: "sonnet" });
    // The user prompt should include the diff so the model has context.
    const [, userPrompt] = llmGenerateMock.mock.calls[0] as [string, string];
    expect(userPrompt).toContain("foo.ts");
  });

  it("returns HTTP 400 with hasChanges=false when the working tree is clean", async () => {
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });

    const h = makePostGitCommitMessageHandler(root);
    const req = new FakeReq("POST", "/api/git/commit-message", { provider: "claude-cli" });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(llmGenerateMock).not.toHaveBeenCalled();
  });

  it("propagates LLM errors as HTTP 500 with structured error body", async () => {
    queueProcess({ stdout: "diff", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 });
    llmGenerateMock.mockRejectedValueOnce(new Error("upstream timeout"));

    const h = makePostGitCommitMessageHandler(root);
    const req = new FakeReq("POST", "/api/git/commit-message", { provider: "claude-cli" });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { error: string };
    expect(body.error).toContain("upstream timeout");
  });

  it("truncates very large diffs before sending to the LLM (cap at ~10K chars)", async () => {
    const huge = "+x\n".repeat(20_000); // ~60KB
    queueProcess({ stdout: huge, stderr: "", exitCode: 0 });
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 });
    llmGenerateMock.mockResolvedValueOnce({
      text: "chore: bulk update", durationMs: 10, inputTokens: null, outputTokens: null, cost: null, billingMode: "subscription",
    });

    const h = makePostGitCommitMessageHandler(root);
    const req = new FakeReq("POST", "/api/git/commit-message", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    const [, userPrompt] = llmGenerateMock.mock.calls[0] as [string, string];
    // Cap is 10K chars on the diff payload itself; full prompt may be larger
    // due to the wrapper text but should not include the entire 60KB diff.
    expect(userPrompt.length).toBeLessThan(15_000);
    expect(userPrompt).toContain("truncated");
  });
});

// ---------------------------------------------------------------------------
// POST /api/git/publish — extended with optional commitMessage
// ---------------------------------------------------------------------------

describe("POST /api/git/publish (with commitMessage)", () => {
  it("runs `git add -A` then `git commit -m <msg>` then `git push` when commitMessage is provided AND dirty", async () => {
    // Order: status --porcelain (dirty check), add -A, commit -m, push, rev-parse HEAD, remote get-url, rev-parse abbrev-ref
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 }); // status (dirty)
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // add -A
    queueProcess({ stdout: "[main abc1234] feat: x\n", stderr: "", exitCode: 0 }); // commit
    queueProcess({ stdout: "Pushed\n", stderr: "", exitCode: 0 }); // push
    queueProcess({ stdout: "abc1234\n", stderr: "", exitCode: 0 }); // rev-parse HEAD
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 }); // remote
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 }); // branch

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", { commitMessage: "feat: add foo" });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    // Confirm the spawn sequence: argv must include `add -A`, then `commit -m "feat: add foo"`, then `push`
    const callArgs = spawnMock.mock.calls.map((c) => (c as [string, string[]])[1]);
    expect(callArgs).toContainEqual(["status", "--porcelain"]);
    expect(callArgs).toContainEqual(["add", "-A"]);
    expect(callArgs).toContainEqual(["commit", "-m", "feat: add foo"]);
    expect(callArgs).toContainEqual(["push"]);
    // Order matters: add must come before commit, commit before push
    const idxAdd = callArgs.findIndex((a) => a[0] === "add");
    const idxCommit = callArgs.findIndex((a) => a[0] === "commit");
    const idxPush = callArgs.findIndex((a) => a[0] === "push");
    expect(idxAdd).toBeLessThan(idxCommit);
    expect(idxCommit).toBeLessThan(idxPush);
  });

  it("skips add+commit when commitMessage is provided but the working tree is clean", async () => {
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // status (clean)
    queueProcess({ stdout: "Everything up-to-date\n", stderr: "", exitCode: 0 }); // push
    queueProcess({ stdout: "abc\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", { commitMessage: "noop" });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const callArgs = spawnMock.mock.calls.map((c) => (c as [string, string[]])[1]);
    expect(callArgs.find((a) => a[0] === "add")).toBeUndefined();
    expect(callArgs.find((a) => a[0] === "commit")).toBeUndefined();
    expect(callArgs).toContainEqual(["push"]);
  });

  it("preserves the original behaviour (no add/commit) when commitMessage is omitted", async () => {
    // No status check needed when commitMessage is absent — we just push.
    queueProcess({ stdout: "Everything up-to-date\n", stderr: "", exitCode: 0 }); // push
    queueProcess({ stdout: "abc\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const callArgs = spawnMock.mock.calls.map((c) => (c as [string, string[]])[1]);
    expect(callArgs.find((a) => a[0] === "add")).toBeUndefined();
    expect(callArgs.find((a) => a[0] === "commit")).toBeUndefined();
  });

  it("returns HTTP 500 if `git commit` fails (e.g. nothing to commit, hook rejected)", async () => {
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 }); // status (dirty)
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // add
    queueProcess({ stdout: "", stderr: "hook rejected\n", exitCode: 1 }); // commit FAILS

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", { commitMessage: "x" });
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("hook rejected");
    // Push must NOT have run after a failed commit.
    const callArgs = spawnMock.mock.calls.map((c) => (c as [string, string[]])[1]);
    expect(callArgs.find((a) => a[0] === "push")).toBeUndefined();
  });

  it("uses argv array for git commit -m (no shell injection surface)", async () => {
    queueProcess({ stdout: " M foo.ts\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "[main abc] x\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "Pushed\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "abc\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const evilMessage = "x\"; rm -rf / #";
    const h = makePostGitPublishHandler(root);
    await h(
      new FakeReq("POST", "/api/git/publish", { commitMessage: evilMessage }) as never,
      new FakeRes() as never,
    );

    // The evil message must arrive as a single argv element, NOT in shell:true mode.
    for (const call of spawnMock.mock.calls) {
      const [, , opts] = call as [string, string[], { shell?: boolean } | undefined];
      expect(opts?.shell).not.toBe(true);
    }
    const commitCall = spawnMock.mock.calls.find(
      (c) => (c as [string, string[]])[1][0] === "commit",
    );
    expect(commitCall).toBeDefined();
    const args = (commitCall as [string, string[]])[1];
    expect(args).toEqual(["commit", "-m", evilMessage]);
  });
});
