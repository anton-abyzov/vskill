// ---------------------------------------------------------------------------
// 0734 — POST /api/studio/install-engine + GET .../install-engine/:jobId/stream
// Tests AC-US5-01, AC-US5-02, AC-US5-03, AC-US5-07, AC-US5-08, AC-US5-09.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as http from "node:http";

// ---------------------------------------------------------------------------
// Hoisted mocks: child_process.spawn + which-style PATH lookup
// ---------------------------------------------------------------------------

const procMock = vi.hoisted(() => {
  type SpawnedProc = EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => void;
    pid: number;
    killed: boolean;
  };

  const spawnCalls: Array<{ command: string; args: string[] }> = [];
  let nextProc: SpawnedProc | null = null;

  function makeProc(): SpawnedProc {
    const proc = new EventEmitter() as SpawnedProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.pid = 12345;
    proc.killed = false;
    proc.kill = (_signal?: string) => {
      proc.killed = true;
      setImmediate(() => proc.emit("exit", null, "SIGTERM"));
    };
    return proc;
  }

  const spawn = vi.fn((command: string, args: string[]) => {
    spawnCalls.push({ command, args });
    nextProc = makeProc();
    return nextProc;
  });

  const cliPresence = { claude: true, vskill: true };

  return { spawnCalls, spawn, makeProc, getNextProc: () => nextProc, cliPresence };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: procMock.spawn,
  };
});

// Mock which-style detection helper used inside the route to validate prerequisite CLIs.
vi.mock("../install-engine-routes-helpers.js", () => ({
  isCliAvailable: (cmd: string) => {
    if (cmd === "claude") return procMock.cliPresence.claude;
    if (cmd === "vskill") return procMock.cliPresence.vskill;
    return false;
  },
}));

const { Router } = await import("../router.js");
const { registerInstallEngineRoutes } = await import("../install-engine-routes.js");
const { studioTokenHeaders } = await import("./helpers/studio-token-test-helpers.js");

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface CapturedRes {
  status: number;
  body: unknown;
  events: Array<{ event: string; data: unknown }>;
  ended: boolean;
  res: http.ServerResponse;
}

function makeReqRes(opts: {
  method: "GET" | "POST";
  url: string;
  bodyJson?: unknown;
  remoteAddress?: string;
}): { req: http.IncomingMessage; res: http.ServerResponse; captured: CapturedRes } {
  const bodyStr = opts.bodyJson != null ? JSON.stringify(opts.bodyJson) : "";

  const reqEvents = new EventEmitter();
  const req: any = {
    method: opts.method,
    url: opts.url,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: "127.0.0.1:3077",
      "content-length": String(Buffer.byteLength(bodyStr)),
      // 0836 US-002: include X-Studio-Token so the gate lets the request reach
      // the route handler. The loopback-IP guard inside the handler is the
      // unit under test for AC-US5-08; this header is incidental.
      ...studioTokenHeaders(),
    },
    socket: { remoteAddress: opts.remoteAddress ?? "127.0.0.1" },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === "data" && bodyStr) setImmediate(() => cb(Buffer.from(bodyStr)));
      else if (event === "end") setImmediate(() => cb());
      else reqEvents.on(event, cb);
      return req;
    },
    emit: reqEvents.emit.bind(reqEvents),
  };

  let raw = "";
  const captured: CapturedRes = {
    status: 0,
    body: null,
    events: [],
    ended: false,
    res: null as unknown as http.ServerResponse,
  };

  const resObj: any = {
    statusCode: 200,
    headersSent: false,
    setHeader: () => {},
    writeHead(s: number) { captured.status = s; },
    write(chunk: string) {
      raw += chunk;
      // Parse SSE-style frames as they accumulate.
      const frames = raw.split("\n\n");
      raw = frames.pop() || "";
      for (const frame of frames) {
        const line = frame.split("\n");
        const evLine = line.find((l) => l.startsWith("event: "));
        const dataLine = line.find((l) => l.startsWith("data: "));
        if (evLine && dataLine) {
          const event = evLine.slice("event: ".length);
          let data: unknown = dataLine.slice("data: ".length);
          try { data = JSON.parse(data as string); } catch { /* keep raw */ }
          captured.events.push({ event, data });
        }
      }
    },
    end(chunk?: string) {
      if (chunk) {
        try { captured.body = JSON.parse(chunk); } catch { captured.body = chunk; }
      }
      if (captured.status === 0) captured.status = resObj.statusCode;
      captured.ended = true;
    },
    on: () => {},
  };
  captured.res = resObj as http.ServerResponse;

  return { req: req as http.IncomingMessage, res: resObj as http.ServerResponse, captured };
}

beforeEach(() => {
  procMock.spawnCalls.length = 0;
  procMock.spawn.mockClear();
  procMock.cliPresence.claude = true;
  procMock.cliPresence.vskill = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

function buildRouter(): InstanceType<typeof Router> {
  const router = new Router();
  registerInstallEngineRoutes(router, "/fake/root");
  return router;
}

async function callPost(bodyJson: unknown, remoteAddress = "127.0.0.1") {
  const router = buildRouter();
  const { req, res, captured } = makeReqRes({
    method: "POST",
    url: "/api/studio/install-engine",
    bodyJson,
    remoteAddress,
  });
  await router.handle(req, res);
  await new Promise((r) => setImmediate(r));
  return captured;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AC-US5-01: POST /api/studio/install-engine returns 202 with jobId", () => {
  it("accepts a valid engine name and returns 202 + jobId", async () => {
    const captured = await callPost({ engine: "vskill" });
    expect(captured.status).toBe(202);
    const body = captured.body as { jobId: string };
    expect(body.jobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 400 for unknown engine names", async () => {
    const captured = await callPost({ engine: "garbage" });
    expect(captured.status).toBe(400);
    expect(captured.body).toEqual(expect.objectContaining({ error: expect.stringMatching(/engine/i) }));
  });

  it("returns 400 when engine field is missing", async () => {
    const captured = await callPost({});
    expect(captured.status).toBe(400);
  });
});

describe("AC-US5-02: prerequisite CLI checks", () => {
  it("returns 412 with remediation when 'claude' CLI is missing for anthropic-skill-creator", async () => {
    procMock.cliPresence.claude = false;
    const captured = await callPost({ engine: "anthropic-skill-creator" });
    expect(captured.status).toBe(412);
    expect(captured.body).toEqual({
      error: "claude-cli-missing",
      remediation: "Install Claude Code CLI first: https://docs.claude.com/claude-code",
    });
  });
});

describe("AC-US5-08: localhost-only guard", () => {
  it("returns 403 when remoteAddress is not 127.0.0.1 or ::1", async () => {
    const captured = await callPost({ engine: "vskill" }, "10.0.0.42");
    expect(captured.status).toBe(403);
    expect(captured.body).toEqual(expect.objectContaining({ error: expect.stringMatching(/localhost/i) }));
  });

  it("accepts ::1 (IPv6 loopback)", async () => {
    const captured = await callPost({ engine: "vskill" }, "::1");
    expect(captured.status).toBe(202);
  });
});

describe("AC-US5-07: hard-coded command allow-list (no shell injection surface)", () => {
  it("spawns 'claude plugin install skill-creator' for anthropic-skill-creator", async () => {
    await callPost({ engine: "anthropic-skill-creator" });
    // Allow async spawn to fire.
    await new Promise((r) => setTimeout(r, 5));
    expect(procMock.spawnCalls).toHaveLength(1);
    expect(procMock.spawnCalls[0].command).toBe("claude");
    expect(procMock.spawnCalls[0].args).toEqual(["plugin", "install", "skill-creator"]);
  });

  it("spawns 'vskill install anton-abyzov/vskill/...' for vskill", async () => {
    await callPost({ engine: "vskill" });
    await new Promise((r) => setTimeout(r, 5));
    expect(procMock.spawnCalls).toHaveLength(1);
    expect(procMock.spawnCalls[0].command).toBe("vskill");
    expect(procMock.spawnCalls[0].args).toEqual([
      "install",
      "anton-abyzov/vskill/skill-builder",
    ]);
  });
});

describe("AC-US5-03 + AC-US5-09: SSE stream on /:jobId/stream", () => {
  async function startInstallAndOpenStream(): Promise<{
    captured: CapturedRes;
    proc: ReturnType<typeof procMock.makeProc>;
  }> {
    const router = buildRouter();
    // POST install
    const post = makeReqRes({
      method: "POST",
      url: "/api/studio/install-engine",
      bodyJson: { engine: "vskill" },
    });
    await router.handle(post.req, post.res);
    const jobId = (post.captured.body as { jobId: string }).jobId;

    // Allow spawn to fire.
    await new Promise((r) => setImmediate(r));
    const proc = procMock.getNextProc()!;

    // GET stream
    const stream = makeReqRes({
      method: "GET",
      url: `/api/studio/install-engine/${jobId}/stream`,
    });
    // Don't await — SSE stays open until proc emits 'exit'.
    void router.handle(stream.req, stream.res);
    await new Promise((r) => setImmediate(r));

    return { captured: stream.captured, proc };
  }

  it("emits progress events for stdout lines and a final done event on success", async () => {
    const { captured, proc } = await startInstallAndOpenStream();

    proc.stdout.emit("data", Buffer.from("Resolving...\n"));
    proc.stdout.emit("data", Buffer.from("Installed.\n"));
    proc.emit("exit", 0, null);
    await new Promise((r) => setImmediate(r));

    expect(captured.events.some((e) => e.event === "progress")).toBe(true);
    const done = captured.events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    expect(done!.data).toEqual({ success: true, exitCode: 0, stderr: "" });
  });

  it("emits done with success=false and accumulated stderr on non-zero exit", async () => {
    const { captured, proc } = await startInstallAndOpenStream();

    proc.stderr.emit("data", Buffer.from("network unreachable\n"));
    proc.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));

    const done = captured.events.find((e) => e.event === "done");
    expect(done).toBeDefined();
    expect(done!.data).toMatchObject({ success: false, exitCode: 1 });
    expect((done!.data as { stderr: string }).stderr).toContain("network unreachable");
  });
});
