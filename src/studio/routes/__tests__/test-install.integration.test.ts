// ---------------------------------------------------------------------------
// T-009 [TDD-RED] — test-install route integration tests
// AC-US2-01 (SSE start→copied→indexed→done; reuses copyPluginFiltered)
// AC-US2-02 (?dest=global targets ~/.claude/skills; default is INSTALLED)
// AC-US2-03 (dest row surfaces after scanner refresh — verified via SSE done)
// AC-US2-04 (409 on collision without overwrite)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerTestInstallRoute } from "../test-install.js";

const opsTmp = join(tmpdir(), `vskill-ops-ti-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(opsTmp, { recursive: true });
process.env.VSKILL_OPS_LOG_PATH = join(opsTmp, "ops.jsonl");

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
  registerTestInstallRoute(fakeRouter, root, home);
  return handlers;
}

function fakeReq(query = ""): any {
  return {
    method: "POST",
    url: `/api/skills/p/demo/test-install${query}`,
    headers: { accept: "text/event-stream" },
    on: (_e: string, _c: any) => {},
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

function parseSSE(body: string) {
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

let workRoot: string;
let homeRoot: string;

function seedOwnSkill(name: string, withSidecar = true) {
  const dir = join(workRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: demo\n---\n# ${name}\n`,
    "utf-8",
  );
  if (withSidecar) {
    writeFileSync(
      join(dir, ".vskill-meta.json"),
      JSON.stringify({ promotedFrom: "installed", sourcePath: "/x", promotedAt: 0 }),
      "utf-8",
    );
  }
}

beforeEach(() => {
  workRoot = join(tmpdir(), `vskill-ti-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  homeRoot = join(tmpdir(), `vskill-ti-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(homeRoot, { recursive: true });
});

afterEach(() => {
  try { rmSync(workRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(homeRoot, { recursive: true, force: true }); } catch {}
});

describe("POST /api/skills/:plugin/:skill/test-install", () => {
  it("registers under POST", () => {
    const h = captureHandlers(workRoot, homeRoot);
    expect(h.post["/api/skills/:plugin/:skill/test-install"]).toBeDefined();
  });

  it("default dest is INSTALLED (<root>/.claude/skills/<name>/) (AC-US2-02)", async () => {
    seedOwnSkill("demo");
    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/test-install"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    expect(events.map((e) => e.event)).toEqual(["started", "copied", "indexed", "done"]);

    expect(existsSync(join(workRoot, ".claude", "skills", "demo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(homeRoot, ".claude", "skills", "demo"))).toBe(false);
  });

  it("?dest=global targets <home>/.claude/skills/<name>/ (AC-US2-02)", async () => {
    seedOwnSkill("demo");
    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/test-install"];

    const res = fakeRes();
    await handler(fakeReq("?dest=global"), res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    expect(events.map((e) => e.event)).toEqual(["started", "copied", "indexed", "done"]);
    expect((events[0].data as any).toScope).toBe("global");

    expect(existsSync(join(homeRoot, ".claude", "skills", "demo", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workRoot, ".claude", "skills", "demo"))).toBe(false);
  });

  it(".vskill-meta.json sidecar is NOT present at dest (AC-US2-01)", async () => {
    seedOwnSkill("demo", true);
    // Sanity: sidecar is in OWN source
    expect(existsSync(join(workRoot, "skills", "demo", ".vskill-meta.json"))).toBe(true);

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/test-install"];

    await handler(fakeReq(), fakeRes(), { plugin: "p", skill: "demo" });

    const dest = join(workRoot, ".claude", "skills", "demo");
    expect(existsSync(join(dest, "SKILL.md"))).toBe(true);
    expect(existsSync(join(dest, ".vskill-meta.json"))).toBe(false);
  });

  it("returns 409 on collision without ?overwrite (AC-US2-04)", async () => {
    seedOwnSkill("demo");
    const dest = join(workRoot, ".claude", "skills", "demo");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "existing", "utf-8");

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/test-install"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    expect((res as any).captured.status).toBe(409);
    const body = JSON.parse((res as any).captured.body);
    expect(body.code).toBe("collision");
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("existing");
  });

  it("overwrites when ?overwrite=true passed", async () => {
    seedOwnSkill("demo");
    const dest = join(workRoot, ".claude", "skills", "demo");
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "existing", "utf-8");

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/test-install"];

    const res = fakeRes();
    await handler(fakeReq("?overwrite=true"), res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    expect(events.map((e) => e.event)).toEqual(["started", "copied", "indexed", "done"]);
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).not.toBe("existing");
  });
});
