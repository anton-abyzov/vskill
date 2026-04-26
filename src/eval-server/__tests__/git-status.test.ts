// ---------------------------------------------------------------------------
// 0759 Phase 6 — GET /api/git/status tests.
//
// Lightweight porcelain probe used by the sidebar to highlight skills with
// uncommitted changes. Parses `git status --porcelain` output into a flat
// list of paths (no prefix). This endpoint is poll-friendly (cheap) — the
// heavier /api/git/diff endpoint stays the source of truth for the publish
// drawer's commit-message generation.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";

const { spawnMock, queueProcess } = vi.hoisted(() => {
  type Q = { stdout: string; stderr: string; exitCode: number | null };
  const queue: Q[] = [];
  const spawnMock = vi.fn(() => {
    const q = queue.shift() ?? { stdout: "", stderr: "", exitCode: 0 };
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean; killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("close", null, "SIGTERM")); return true; };
    setImmediate(() => {
      if (q.stdout) proc.stdout.emit("data", Buffer.from(q.stdout));
      if (q.stderr) proc.stderr.emit("data", Buffer.from(q.stderr));
      if (q.exitCode !== null) proc.emit("close", q.exitCode, null);
    });
    return proc;
  });
  return { spawnMock, queueProcess: (q: Q) => queue.push(q) };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const { makeGetGitStatusHandler } = await import("../git-routes.js");

class FakeReq extends EventEmitter {
  headers: Record<string, string> = {};
  method = "GET";
  url = "/api/git/status";
  socket = { remoteAddress: "127.0.0.1" };
  constructor() {
    super();
    process.nextTick(() => this.emit("end"));
  }
}

class FakeRes {
  statusCode = 200;
  body = "";
  writeHead(s: number) { this.statusCode = s; }
  setHeader() {}
  end(d?: string) { if (d !== undefined) this.body += d; }
  get json(): unknown { return JSON.parse(this.body); }
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vskill-git-status-"));
  spawnMock.mockClear();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/git/status", () => {
  it("returns parsed porcelain paths (status prefix stripped)", async () => {
    queueProcess({
      stdout: " M skills/a/SKILL.md\n?? skills/a/notes.md\nA  newfile.ts\n",
      stderr: "",
      exitCode: 0,
    });
    const h = makeGetGitStatusHandler(root);
    const res = new FakeRes();
    await h(new FakeReq() as never, res as never);

    expect(res.statusCode).toBe(200);
    const body = res.json as { paths: string[] };
    expect(body.paths).toEqual([
      "skills/a/SKILL.md",
      "skills/a/notes.md",
      "newfile.ts",
    ]);
  });

  it("returns an empty array when the working tree is clean", async () => {
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    const h = makeGetGitStatusHandler(root);
    const res = new FakeRes();
    await h(new FakeReq() as never, res as never);

    expect(res.statusCode).toBe(200);
    expect((res.json as { paths: string[] }).paths).toEqual([]);
  });

  it("returns an empty array when the workspace is not a git repo (porcelain non-zero exit)", async () => {
    queueProcess({ stdout: "", stderr: "fatal: not a git repository\n", exitCode: 128 });
    const h = makeGetGitStatusHandler(root);
    const res = new FakeRes();
    await h(new FakeReq() as never, res as never);

    expect(res.statusCode).toBe(200);
    expect((res.json as { paths: string[] }).paths).toEqual([]);
  });

  it("invokes git with argv array (no shell interpolation)", async () => {
    queueProcess({ stdout: "", stderr: "", exitCode: 0 });
    const h = makeGetGitStatusHandler(root);
    await h(new FakeReq() as never, new FakeRes() as never);

    const call = spawnMock.mock.calls[0] as [string, string[], { shell?: boolean; cwd?: string }];
    expect(call[0]).toBe("git");
    expect(call[1]).toEqual(["status", "--porcelain"]);
    expect(call[2]?.shell).not.toBe(true);
    expect(call[2]?.cwd).toBe(root);
  });
});
