// ---------------------------------------------------------------------------
// 0759 — git-routes tests: GET /api/git/remote and POST /api/git/publish.
// Spawns are mocked via vi.hoisted + vi.mock("node:child_process") so we can
// drive exit codes, stdout/stderr, and timing deterministically.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Hoist a controllable spawn mock so handlers see whatever stdout/stderr/exit
// each test queues up.
const { spawnMock, queueProcess, setGitPathProbe } = vi.hoisted(() => {
  type Queued = {
    stdout: string;
    stderr: string;
    exitCode: number | null; // null → never exits (timeout test)
    delayMs?: number;
  };
  const queue: Queued[] = [];
  // 0875 — when non-empty, the mid-rebase pre-flight `git rev-parse --git-path`
  // probe resolves to this path (point it at a real dir to simulate mid-rebase).
  const gitPathProbe = { value: "" };
  const spawnMock = vi.fn((_cmd: string, _args: readonly string[], _opts?: unknown) => {
    // 0875 — the publish handler runs a mid-rebase pre-flight via
    // `git rev-parse --git-path rebase-merge|rebase-apply` BEFORE the normal
    // flow. Tests don't queue those probes, so intercept them here and return
    // an empty path (→ existsSync false → not mid-rebase) WITHOUT consuming the
    // queue, keeping every existing test's queued sequence intact. A test that
    // wants to simulate mid-rebase points the probe at a real dir via
    // `setGitPathProbe(<absolute path that exists>)`.
    const args = _args as readonly string[];
    if (args[0] === "rev-parse" && args[1] === "--git-path") {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean; killed: boolean };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = () => true;
      const out = gitPathProbe.value;
      setImmediate(() => {
        if (out) proc.stdout.emit("data", Buffer.from(out + "\n"));
        proc.emit("close", 0, null);
      });
      return proc;
    }
    const q = queue.shift() ?? { stdout: "", stderr: "", exitCode: 0 };
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig?: string) => boolean;
      killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = (_sig?: string) => {
      proc.killed = true;
      // Simulate node's behavior: emit close after kill
      setImmediate(() => proc.emit("close", null, "SIGTERM"));
      return true;
    };
    const fire = () => {
      if (q.stdout) proc.stdout.emit("data", Buffer.from(q.stdout));
      if (q.stderr) proc.stderr.emit("data", Buffer.from(q.stderr));
      if (q.exitCode !== null) proc.emit("close", q.exitCode, null);
      // exitCode === null means we never close — timeout test will kill us
    };
    if (q.delayMs && q.delayMs > 0) setTimeout(fire, q.delayMs);
    else setImmediate(fire);
    return proc;
  });
  const queueProcess = (q: Queued) => queue.push(q);
  const setGitPathProbe = (p: string) => { gitPathProbe.value = p; };
  return { spawnMock, queueProcess, setGitPathProbe };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

// Now import the module under test (after the mock is registered).
const { makeGetGitRemoteHandler, makePostGitPublishHandler } = await import("../git-routes.js");
const { enhancedPath, _resetEnhancedSpawnEnvCache } = await import("../../utils/resolve-binary.js");

class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  method: string;
  url: string;
  socket: { remoteAddress: string };
  constructor(
    method: string,
    url: string,
    body?: unknown,
    remoteAddress = "127.0.0.1",
    origin?: string,
  ) {
    super();
    this.method = method;
    this.url = url;
    this.socket = { remoteAddress };
    if (origin !== undefined) this.headers["origin"] = origin;
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
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    if (headers) Object.assign(this.headers, headers);
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  end(data?: string) {
    if (data !== undefined) this.body += data;
  }
  get json(): unknown {
    return JSON.parse(this.body);
  }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-git-"));
  spawnMock.mockClear();
  setGitPathProbe(""); // 0875 — default: not mid-rebase
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.GIT_PUBLISH_TIMEOUT_MS;
});

// ---------------------------------------------------------------------------
// GET /api/git/remote
// ---------------------------------------------------------------------------

describe("GET /api/git/remote", () => {
  it("returns hasRemote=true with remoteUrl + branch when remote configured", async () => {
    queueProcess({ stdout: "https://github.com/owner/repo.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makeGetGitRemoteHandler(root);
    const req = new FakeReq("GET", "/api/git/remote");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { remoteUrl: string; branch: string; hasRemote: boolean };
    expect(body).toEqual({
      remoteUrl: "https://github.com/owner/repo.git",
      branch: "main",
      hasRemote: true,
    });
  });

  it("returns hasRemote=false with HTTP 200 when no remote configured", async () => {
    queueProcess({ stdout: "", stderr: "fatal: No such remote 'origin'\n", exitCode: 2 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makeGetGitRemoteHandler(root);
    const req = new FakeReq("GET", "/api/git/remote");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { remoteUrl: string | null; hasRemote: boolean };
    expect(body.remoteUrl).toBeNull();
    expect(body.hasRemote).toBe(false);
  });

  it("uses spawn with argv array (NOT shell-string interpolation)", async () => {
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makeGetGitRemoteHandler(root);
    await h(new FakeReq("GET", "/api/git/remote") as never, new FakeRes() as never);

    // Every spawn call should have an argv array — never a shell:true option,
    // never a single command string.
    expect(spawnMock).toHaveBeenCalled();
    for (const call of spawnMock.mock.calls) {
      const [cmd, args, opts] = call as [string, string[], { shell?: boolean } | undefined];
      expect(cmd).toBe("git");
      expect(Array.isArray(args)).toBe(true);
      expect(opts?.shell).not.toBe(true);
    }
  });

  it("returns HTTP 403 when request comes from a non-loopback address", async () => {
    const h = makeGetGitRemoteHandler(root);
    const req = new FakeReq("GET", "/api/git/remote", undefined, "203.0.113.5");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns HTTP 403 on CSRF: cross-site Origin header from non-localhost", async () => {
    const h = makeGetGitRemoteHandler(root);
    const req = new FakeReq("GET", "/api/git/remote", undefined, "127.0.0.1", "https://evil.example.com");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/git/publish
// ---------------------------------------------------------------------------

describe("POST /api/git/publish", () => {
  it("spawns git with an enhanced PATH so the Git-LFS pre-push hook can find git-lfs", async () => {
    // Regression: a Dock/Spotlight-launched studio inherits a truncated PATH
    // (no /opt/homebrew/bin). git push then runs the repo's LFS `pre-push`
    // hook, which shells out to `git-lfs` and aborts with "git-lfs was not
    // found on your path". The handler must spawn git with enhancedPath() so
    // hooks + credential/LFS helpers resolve regardless of launch context.
    _resetEnhancedSpawnEnvCache();
    queueProcess({ stdout: "", stderr: "", exitCode: 0 }); // push
    queueProcess({ stdout: "abc1234\n", stderr: "", exitCode: 0 }); // rev-parse HEAD
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 }); // remote
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 }); // abbrev-ref

    const h = makePostGitPublishHandler(root);
    await h(new FakeReq("POST", "/api/git/publish", {}) as never, new FakeRes() as never);

    const expectedPath = enhancedPath(process.env.PATH);
    expect(spawnMock).toHaveBeenCalled();
    for (const call of spawnMock.mock.calls) {
      const [, , opts] = call as [string, string[], { env?: NodeJS.ProcessEnv } | undefined];
      expect(opts?.env?.PATH).toBe(expectedPath);
    }
  });

  it("returns success=true with stdout/stderr on exit 0", async () => {
    // git push, git rev-parse HEAD, git remote get-url, git rev-parse abbrev-ref
    queueProcess({ stdout: "Everything up-to-date\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "abc1234def567890\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/owner/repo.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as {
      success: boolean;
      commitSha: string;
      branch: string;
      remoteUrl: string;
      stdout: string;
    };
    expect(body.success).toBe(true);
    expect(body.commitSha).toBe("abc1234def567890");
    expect(body.branch).toBe("main");
    expect(body.remoteUrl).toBe("https://github.com/owner/repo.git");
    expect(body.stdout).toContain("Everything up-to-date");
  });

  it("returns HTTP 500 with success=false + stderr when push exits non-zero (non-reconcilable error)", async () => {
    // A failure that is NOT a non-fast-forward rejection (e.g. auth) must still
    // surface as a hard 500 with the raw stderr — no rebase reconciliation.
    queueProcess({
      stdout: "",
      stderr: "fatal: Authentication failed for 'https://github.com/o/r.git/'\n",
      exitCode: 128,
    });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; stderr: string };
    expect(body.success).toBe(false);
    expect(body.stderr).toContain("Authentication failed");
  });

  it("kills subprocess and returns timeout error when push exceeds GIT_PUBLISH_TIMEOUT_MS", async () => {
    process.env.GIT_PUBLISH_TIMEOUT_MS = "50";
    queueProcess({ stdout: "", stderr: "", exitCode: null }); // never exits

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; stderr: string };
    expect(body.success).toBe(false);
    expect(body.stderr.toLowerCase()).toContain("timeout");
  });

  it("uses argv array for git push (no shell injection surface)", async () => {
    queueProcess({ stdout: "ok\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "abc1234\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    await h(
      new FakeReq("POST", "/api/git/publish", {}) as never,
      new FakeRes() as never,
    );

    // The `git push` spawn MUST use an argv array, no shell:true. (A mid-rebase
    // pre-flight `rev-parse --git-path` probe runs first now, so locate the
    // push call rather than assuming it is call index 0.)
    const pushCall = spawnMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).length === 1 && (c[1] as string[])[0] === "push",
    ) as [string, string[], { shell?: boolean }] | undefined;
    expect(pushCall).toBeDefined();
    expect(pushCall![0]).toBe("git");
    expect(pushCall![1]).toEqual(["push"]);
    expect(pushCall![2]?.shell).not.toBe(true);
  });

  it("returns HTTP 403 when request comes from a non-loopback address", async () => {
    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {}, "203.0.113.5");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(403);
    const body = res.json as { success: boolean; stderr: string };
    expect(body.success).toBe(false);
    expect(body.stderr).toContain("loopback");
    // No spawn should have been called
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns HTTP 403 on CSRF: cross-site Origin header from non-localhost", async () => {
    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {}, "127.0.0.1", "https://evil.example.com");
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("body.error is present and contains stderr message on push failure (fetchJson regression)", async () => {
    // This test validates the contract between eval-server and the UI's fetchJson:
    // non-2xx responses MUST include `error` so the error toast shows real stderr.
    // Uses a non-reconcilable failure (a non-fast-forward would now auto-rebase).
    queueProcess({
      stdout: "",
      stderr: "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host\n",
      exitCode: 128,
    });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; error: string; stderr: string };
    expect(body.success).toBe(false);
    // `error` field must be present and contain actionable text (not "HTTP 500")
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("Could not resolve host");
    // stderr is also preserved for diagnostics
    expect(body.stderr).toContain("Could not resolve host");
  });

  // -------------------------------------------------------------------------
  // 0875 — auto-reconcile non-fast-forward push (pull --rebase --autostash).
  // -------------------------------------------------------------------------

  it("auto-reconciles a non-fast-forward push: pull --rebase ok → retry push ok → success+reconciled", async () => {
    // 1) push → rejected (non-fast-forward)
    queueProcess({
      stdout: "",
      stderr: "! [rejected]        main -> main (non-fast-forward)\nhint: Updates were rejected because the tip of your current branch is behind\n",
      exitCode: 1,
    });
    // 2) rev-parse --abbrev-ref HEAD → branch name
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });
    // 3) pull --rebase --autostash origin main → ok
    queueProcess({ stdout: "Successfully rebased and updated refs/heads/main.\n", stderr: "", exitCode: 0 });
    // 4) retry push → ok
    queueProcess({ stdout: "To github.com:o/r.git\n   abc..def  main -> main\n", stderr: "", exitCode: 0 });
    // 5) rev-parse HEAD, 6) remote get-url, 7) rev-parse abbrev-ref (success metadata)
    queueProcess({ stdout: "def5678\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { success: boolean; reconciled: boolean; commitSha: string; branch: string };
    expect(body.success).toBe(true);
    expect(body.reconciled).toBe(true);
    expect(body.commitSha).toBe("def5678");
    expect(body.branch).toBe("main");

    // The reconcile path must invoke `git pull --rebase --autostash origin main`.
    const pullCall = spawnMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "pull",
    ) as [string, string[], unknown] | undefined;
    expect(pullCall).toBeDefined();
    expect(pullCall![1]).toEqual(["pull", "--rebase", "--autostash", "origin", "main"]);
  });

  it("returns conflict=true + conflictedFiles when pull --rebase conflicts (and aborts the rebase)", async () => {
    // 1) push → rejected (non-fast-forward)
    queueProcess({
      stdout: "",
      stderr: "! [rejected]        main -> main (fetch first)\nUpdates were rejected because the remote contains work that you do not have locally\n",
      exitCode: 1,
    });
    // 2) rev-parse --abbrev-ref HEAD → branch name
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });
    // 3) pull --rebase --autostash origin main → CONFLICT
    queueProcess({
      stdout: "Auto-merging skill.md\nCONFLICT (content): Merge conflict in skill.md\n",
      stderr: "error: could not apply abc123... edit skill\n",
      exitCode: 1,
    });
    // 4) diff --name-only --diff-filter=U → conflicted files (collected BEFORE abort)
    queueProcess({ stdout: "skill.md\nREADME.md\n", stderr: "", exitCode: 0 });
    // 5) rebase --abort → ok (best-effort restore)
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    const body = res.json as {
      success: boolean;
      conflict: boolean;
      reason: string;
      conflictedFiles: string[];
      error: string;
    };
    expect(body.success).toBe(false);
    expect(body.conflict).toBe(true);
    expect(body.reason).toBe("rebase_conflict");
    expect(body.conflictedFiles).toEqual(["skill.md", "README.md"]);
    expect(body.error).toContain("skill.md");

    // `git rebase --abort` MUST have been called to restore a clean tree.
    const abortCall = spawnMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "rebase" && (c[1] as string[])[1] === "--abort",
    );
    expect(abortCall).toBeDefined();
  });

  it("reports rebase_failed (not rebase_conflict) when pull fails with NO conflicted files", async () => {
    // A non-conflict pull failure (autostash/network/auth) must not be mislabeled
    // a content conflict — there are no conflicted files to resolve.
    // 1) push → rejected (non-fast-forward)
    queueProcess({
      stdout: "",
      stderr: "! [rejected]        main -> main (non-fast-forward)\n",
      exitCode: 1,
    });
    // 2) rev-parse --abbrev-ref HEAD → branch name
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });
    // 3) pull --rebase --autostash origin main → fails, but not a content conflict
    queueProcess({
      stdout: "",
      stderr: "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host\n",
      exitCode: 128,
    });
    // 4) diff --name-only --diff-filter=U → no conflicted files
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    // 5) rebase --abort → ok
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const res = new FakeRes();
    await h(new FakeReq("POST", "/api/git/publish", {}) as never, res as never);

    const body = res.json as { success: boolean; conflict: boolean; reason: string; conflictedFiles: string[]; error: string };
    expect(body.success).toBe(false);
    expect(body.conflict).toBe(true);
    expect(body.reason).toBe("rebase_failed");
    expect(body.conflictedFiles).toEqual([]);
    // The message must NOT claim a content conflict; it points at a network/auth/autostash cause.
    expect(body.error).not.toContain("conflict with yours in:");
    expect(body.error.toLowerCase()).toContain("network");
  });

  it("warns when `git rebase --abort` itself fails (tree may be left mid-rebase)", async () => {
    // 1) push → rejected
    queueProcess({ stdout: "", stderr: "! [rejected] main -> main (fetch first)\n", exitCode: 1 });
    // 2) rev-parse --abbrev-ref HEAD
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });
    // 3) pull --rebase → CONFLICT
    queueProcess({
      stdout: "CONFLICT (content): Merge conflict in skill.md\n",
      stderr: "error: could not apply\n",
      exitCode: 1,
    });
    // 4) diff --diff-filter=U → conflicted files
    queueProcess({ stdout: "skill.md\n", stderr: "", exitCode: 0 });
    // 5) rebase --abort → ALSO FAILS
    queueProcess({ stdout: "", stderr: "fatal: no rebase in progress?\n", exitCode: 128 });

    const h = makePostGitPublishHandler(root);
    const res = new FakeRes();
    await h(new FakeReq("POST", "/api/git/publish", {}) as never, res as never);

    const body = res.json as { reason: string; error: string };
    expect(body.reason).toBe("rebase_conflict");
    // Abort failure must be surfaced so the user knows the tree may be dirty.
    expect(body.error.toLowerCase()).toContain("rebase --abort");
    expect(body.error.toLowerCase()).toContain("mid-rebase");
  });

  it("skips auto-reconcile on a detached HEAD (branch == 'HEAD')", async () => {
    // 1) push → rejected (non-fast-forward)
    queueProcess({ stdout: "", stderr: "! [rejected] HEAD -> main (non-fast-forward)\n", exitCode: 1 });
    // 2) rev-parse --abbrev-ref HEAD → "HEAD" (detached)
    queueProcess({ stdout: "HEAD\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const res = new FakeRes();
    await h(new FakeReq("POST", "/api/git/publish", {}) as never, res as never);

    // No pull/rebase may be attempted on a detached HEAD — it falls through to
    // the generic push-failure handler instead.
    const sawPull = spawnMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "pull",
    );
    expect(sawPull).toBe(false);
    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; reconciled?: boolean };
    expect(body.success).toBe(false);
    expect(body.reconciled).toBeFalsy();
  });

  it("blocks publish with 409 mid_rebase when the repo is left mid-rebase", async () => {
    // 0875 — a prior auto-reconcile left .git/rebase-merge behind. The publish
    // handler must bail BEFORE add/commit instead of committing onto a dirty,
    // interrupted-rebase tree.
    const rebaseDir = join(root, ".git", "rebase-merge");
    mkdirSync(rebaseDir, { recursive: true });
    setGitPathProbe(rebaseDir);

    const h = makePostGitPublishHandler(root);
    const res = new FakeRes();
    await h(new FakeReq("POST", "/api/git/publish", { commitMessage: "feat: x" }) as never, res as never);

    expect(res.statusCode).toBe(409);
    const body = res.json as { success: boolean; reason: string; error: string };
    expect(body.success).toBe(false);
    expect(body.reason).toBe("mid_rebase");
    expect(body.error.toLowerCase()).toContain("mid-rebase");

    // It must NOT have proceeded to add/commit/push.
    const sawAdd = spawnMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "add",
    );
    expect(sawAdd).toBe(false);
  });

  it("returns a timeout error when the RETRY push (after a clean rebase) times out", async () => {
    process.env.GIT_PUBLISH_TIMEOUT_MS = "50";
    // 1) push → rejected (non-fast-forward)
    queueProcess({ stdout: "", stderr: "! [rejected] main -> main (non-fast-forward)\n", exitCode: 1 });
    // 2) rev-parse --abbrev-ref HEAD
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });
    // 3) pull --rebase --autostash → clean
    queueProcess({ stdout: "Successfully rebased and updated refs/heads/main.\n", stderr: "", exitCode: 0 });
    // 4) retry push → NEVER exits (timeout)
    queueProcess({ stdout: "", stderr: "", exitCode: null });

    const h = makePostGitPublishHandler(root);
    const res = new FakeRes();
    await h(new FakeReq("POST", "/api/git/publish", {}) as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; error: string; stderr: string };
    expect(body.success).toBe(false);
    // Must be a detailed timeout, not an empty-string "Publish failed." fall-through.
    expect(body.error.toLowerCase()).toContain("timeout");
    expect(body.error.toLowerCase()).toContain("retry");
  });

  it("does NOT pull/rebase when the first push succeeds (happy path unchanged)", async () => {
    // push, rev-parse HEAD, remote get-url, rev-parse abbrev-ref — no pull/rebase.
    queueProcess({ stdout: "Everything up-to-date\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "abc1234\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { success: boolean; reconciled?: boolean };
    expect(body.success).toBe(true);
    // No reconciliation occurred — `reconciled` is absent/falsy on the clean path.
    expect(body.reconciled).toBeFalsy();
    // No pull and no rebase were ever spawned.
    const sawPull = spawnMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "pull",
    );
    const sawRebase = spawnMock.mock.calls.some(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "rebase",
    );
    expect(sawPull).toBe(false);
    expect(sawRebase).toBe(false);
  });

  it("passes cwd=root to spawn so git operates in the workspace", async () => {
    queueProcess({ stdout: "ok\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "abc\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "https://github.com/o/r.git\n", stderr: "", exitCode: 0 });
    queueProcess({ stdout: "main\n", stderr: "", exitCode: 0 });

    const h = makePostGitPublishHandler(root);
    await h(
      new FakeReq("POST", "/api/git/publish", {}) as never,
      new FakeRes() as never,
    );

    // Every git spawn (the mid-rebase probe AND the push) must run with cwd=root.
    const pushCall = spawnMock.mock.calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[])[0] === "push",
    ) as [string, string[], { cwd?: string }] | undefined;
    expect(pushCall).toBeDefined();
    expect(pushCall![2]?.cwd).toBe(root);
  });
});
