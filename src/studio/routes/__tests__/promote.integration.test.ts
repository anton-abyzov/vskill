// ---------------------------------------------------------------------------
// T-007 [TDD-RED] — promote route integration tests
// AC-US1-01 (SSE sequence started → copied → indexed → done)
// AC-US1-03 (collision → 409 {ok:false,code:"collision",path}, no fs change)
// AC-US1-04 (.vskill-meta.json sidecar written to dest)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerPromoteRoute } from "../promote.js";

// Override the ops-log path BEFORE the lib loads so test appends never touch
// the real ~/.vskill/studio-ops.jsonl.
const opsTmp = join(tmpdir(), `vskill-ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(opsTmp, { recursive: true });
process.env.VSKILL_OPS_LOG_PATH = join(opsTmp, "ops.jsonl");

// ---------------------------------------------------------------------------
// Router + req/res harness
// ---------------------------------------------------------------------------

interface Captured {
  get: Record<string, any>;
  post: Record<string, any>;
  put: Record<string, any>;
  delete: Record<string, any>;
}

function captureHandlers(root: string, home: string): Captured {
  const handlers: Captured = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter: any = {
    get: (p: string, h: any) => { handlers.get[p] = h; },
    post: (p: string, h: any) => { handlers.post[p] = h; },
    put: (p: string, h: any) => { handlers.put[p] = h; },
    delete: (p: string, h: any) => { handlers.delete[p] = h; },
  };
  registerPromoteRoute(fakeRouter, root, home);
  return handlers;
}

function fakeReq(query = ""): any {
  return {
    method: "POST",
    url: `/api/skills/p/demo/promote${query}`,
    headers: { accept: "text/event-stream" },
    on: (_event: string, _cb: any) => {},
  };
}

function fakeRes() {
  const captured = { body: "", status: 0, headers: {} as Record<string, string>, ended: false };
  const res: any = {
    headersSent: false,
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) captured.headers = { ...captured.headers, ...headers };
      res.headersSent = true;
    },
    write(chunk: string | Buffer) {
      captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += typeof chunk === "string" ? chunk : chunk.toString();
      captured.ended = true;
    },
    on: vi.fn(),
    setHeader: vi.fn(),
  };
  Object.defineProperty(res, "captured", { value: captured });
  return res;
}

function parseSSE(body: string): { event: string; data: any }[] {
  const out: { event: string; data: any }[] = [];
  for (const block of body.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    let parsed: any = data;
    try { parsed = JSON.parse(data); } catch {}
    out.push({ event, data: parsed });
  }
  return out;
}

// ---------------------------------------------------------------------------

let workRoot: string;
let homeRoot: string;

function seedInstalledSkill(name: string) {
  const dir = join(workRoot, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: demo\n---\n# ${name}\n`,
    "utf-8",
  );
}

beforeEach(() => {
  workRoot = join(tmpdir(), `vskill-promote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  homeRoot = join(tmpdir(), `vskill-promote-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(homeRoot, { recursive: true });
});

afterEach(() => {
  try { rmSync(workRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(homeRoot, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/skills/:plugin/:skill/promote", () => {
  it("registers the route under POST", () => {
    const handlers = captureHandlers(workRoot, homeRoot);
    expect(handlers.post["/api/skills/:plugin/:skill/promote"]).toBeDefined();
  });

  it("emits SSE sequence started → copied → indexed → done on happy path (AC-US1-01)", async () => {
    seedInstalledSkill("demo");
    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    const req = fakeReq();
    const res = fakeRes();
    await handler(req, res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    const eventNames = events.map((e) => e.event);
    expect(eventNames).toEqual(["started", "copied", "indexed", "done"]);

    const started = events[0].data;
    expect(started.skillId).toBe("p/demo");
    expect(started.fromScope).toBe("installed");
    expect(started.toScope).toBe("own");
    expect(typeof started.opId).toBe("string");

    const copied = events[1].data;
    expect(copied.filesWritten).toBeGreaterThan(0);

    const done = events[3].data;
    expect(done.opId).toBe(started.opId);
    expect(done.destPath).toBe(join(workRoot, "skills", "demo"));

    // Sanity: dest dir exists with SKILL.md
    expect(existsSync(join(workRoot, "skills", "demo", "SKILL.md"))).toBe(true);
  });

  it("writes .vskill-meta.json provenance sidecar to destination (AC-US1-04)", async () => {
    seedInstalledSkill("demo");
    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    await handler(fakeReq(), fakeRes(), { plugin: "p", skill: "demo" });

    const sidecarPath = join(workRoot, "skills", "demo", ".vskill-meta.json");
    expect(existsSync(sidecarPath)).toBe(true);

    const provenance = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    expect(provenance.promotedFrom).toBe("installed");
    expect(provenance.sourcePath).toBe(join(workRoot, ".claude", "skills", "demo"));
    expect(typeof provenance.promotedAt).toBe("number");
  });

  it("returns 409 with {ok:false,code:'collision',path} when dest exists without ?overwrite (AC-US1-03)", async () => {
    seedInstalledSkill("demo");
    // Pre-populate OWN dir
    const ownDir = join(workRoot, "skills", "demo");
    mkdirSync(ownDir, { recursive: true });
    writeFileSync(join(ownDir, "SKILL.md"), "existing", "utf-8");

    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    expect((res as any).captured.status).toBe(409);
    const body = JSON.parse((res as any).captured.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("collision");
    expect(body.path).toBe(ownDir);

    // Filesystem unchanged: original content preserved, no sidecar written
    expect(readFileSync(join(ownDir, "SKILL.md"), "utf-8")).toBe("existing");
    expect(existsSync(join(ownDir, ".vskill-meta.json"))).toBe(false);
  });

  it("overwrites when ?overwrite=true is passed", async () => {
    seedInstalledSkill("demo");
    const ownDir = join(workRoot, "skills", "demo");
    mkdirSync(ownDir, { recursive: true });
    writeFileSync(join(ownDir, "SKILL.md"), "existing", "utf-8");

    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    const req = fakeReq("?overwrite=true");
    const res = fakeRes();
    await handler(req, res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    expect(events.map((e) => e.event)).toEqual(["started", "copied", "indexed", "done"]);
    expect(readFileSync(join(ownDir, "SKILL.md"), "utf-8")).not.toBe("existing");
  });

  it("uses initSSE/sendSSE (writes proper text/event-stream headers)", async () => {
    seedInstalledSkill("demo");
    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    expect((res as any).captured.headers["Content-Type"]).toBe("text/event-stream");
    expect((res as any).captured.headers["Cache-Control"]).toBe("no-cache");
  });

  it("returns 404 when source skill is missing", async () => {
    const handlers = captureHandlers(workRoot, homeRoot);
    const handler = handlers.post["/api/skills/:plugin/:skill/promote"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "nonexistent" });

    expect((res as any).captured.status).toBe(404);
    const body = JSON.parse((res as any).captured.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("missing-source");
  });
});

void readdirSync;
