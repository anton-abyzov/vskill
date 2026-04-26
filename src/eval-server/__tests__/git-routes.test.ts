// ---------------------------------------------------------------------------
// 0759 — git-routes tests: GET /api/git/remote and POST /api/git/publish.
// Spawns are mocked via vi.hoisted + vi.mock("node:child_process") so we can
// drive exit codes, stdout/stderr, and timing deterministically.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

// Hoist a controllable spawn mock so handlers see whatever stdout/stderr/exit
// each test queues up.
const { spawnMock, queueProcess } = vi.hoisted(() => {
  type Queued = {
    stdout: string;
    stderr: string;
    exitCode: number | null; // null → never exits (timeout test)
    delayMs?: number;
  };
  const queue: Queued[] = [];
  const spawnMock = vi.fn((_cmd: string, _args: readonly string[], _opts?: unknown) => {
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
  return { spawnMock, queueProcess };
});

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

// Now import the module under test (after the mock is registered).
const { makeGetGitRemoteHandler, makePostGitPublishHandler } = await import("../git-routes.js");

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

  it("returns HTTP 500 with success=false + stderr when push exits non-zero", async () => {
    queueProcess({
      stdout: "",
      stderr: "! [rejected]        main -> main (non-fast-forward)\n",
      exitCode: 1,
    });

    const h = makePostGitPublishHandler(root);
    const req = new FakeReq("POST", "/api/git/publish", {});
    const res = new FakeRes();
    await h(req as never, res as never);

    expect(res.statusCode).toBe(500);
    const body = res.json as { success: boolean; stderr: string };
    expect(body.success).toBe(false);
    expect(body.stderr).toContain("non-fast-forward");
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

    // First spawn call MUST be `git push` with argv array, no shell:true
    const firstCall = spawnMock.mock.calls[0] as [string, string[], { shell?: boolean }];
    expect(firstCall[0]).toBe("git");
    expect(firstCall[1]).toEqual(["push"]);
    expect(firstCall[2]?.shell).not.toBe(true);
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
    queueProcess({
      stdout: "",
      stderr: "! [rejected]        main -> main (non-fast-forward)\n",
      exitCode: 1,
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
    expect(body.error).toContain("non-fast-forward");
    // stderr is also preserved for diagnostics
    expect(body.stderr).toContain("non-fast-forward");
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

    const firstCall = spawnMock.mock.calls[0] as [string, string[], { cwd?: string }];
    expect(firstCall[2]?.cwd).toBe(root);
  });
});
