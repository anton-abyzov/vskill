// ---------------------------------------------------------------------------
// T-011 [TDD-RED] — revert route integration tests
// AC-US3-01 (SSE sequence started → deleted → indexed → done; OWN dir removed)
// AC-US3-03/04 (provenance-gated: 400 {code:"no-provenance"} when sidecar
//                absent, no fs change; original promote op preserved in log
//                — append-only, revert appends new op entry)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerRevertRoute } from "../revert.js";
import { appendOp, listOps } from "../../lib/ops-log.js";

const opsTmp = join(tmpdir(), `vskill-ops-rv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
  registerRevertRoute(fakeRouter, root, home);
  return handlers;
}

function fakeReq(query = ""): any {
  return {
    method: "POST",
    url: `/api/skills/p/demo/revert${query}`,
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

function seedOwnSkillWithProvenance(name: string) {
  const dir = join(workRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: demo\n---\n# ${name}\n`,
    "utf-8",
  );
  writeFileSync(
    join(dir, ".vskill-meta.json"),
    JSON.stringify({ promotedFrom: "installed", sourcePath: "/x", promotedAt: 123 }),
    "utf-8",
  );
}

function seedOwnSkillNoProvenance(name: string) {
  const dir = join(workRoot, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\n---\n# ${name}\n`,
    "utf-8",
  );
}

beforeEach(() => {
  workRoot = join(tmpdir(), `vskill-rv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  homeRoot = join(tmpdir(), `vskill-rv-home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(homeRoot, { recursive: true });
  // Fresh ops log per test — point env to a new file.
  process.env.VSKILL_OPS_LOG_PATH = join(opsTmp, `ops-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jsonl`);
});

afterEach(() => {
  try { rmSync(workRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(homeRoot, { recursive: true, force: true }); } catch {}
});

describe("POST /api/skills/:plugin/:skill/revert", () => {
  it("registers under POST", () => {
    const h = captureHandlers(workRoot, homeRoot);
    expect(h.post["/api/skills/:plugin/:skill/revert"]).toBeDefined();
  });

  it("emits SSE sequence started → deleted → indexed → done and removes OWN dir (AC-US3-01)", async () => {
    seedOwnSkillWithProvenance("demo");
    const ownDir = join(workRoot, "skills", "demo");
    expect(existsSync(ownDir)).toBe(true);

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/revert"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    const events = parseSSE((res as any).captured.body);
    expect(events.map((e) => e.event)).toEqual(["started", "deleted", "indexed", "done"]);
    expect((events[1].data as any).filesDeleted).toBeGreaterThan(0);

    // OWN dir physically deleted.
    expect(existsSync(ownDir)).toBe(false);
  });

  it("returns 400 {code:'no-provenance'} when sidecar absent, with no fs change (AC-US3-04)", async () => {
    seedOwnSkillNoProvenance("demo");
    const ownDir = join(workRoot, "skills", "demo");
    const originalContent = readFileSync(join(ownDir, "SKILL.md"), "utf-8");

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/revert"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "demo" });

    expect((res as any).captured.status).toBe(400);
    const body = JSON.parse((res as any).captured.body);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("no-provenance");

    // Filesystem unchanged
    expect(existsSync(ownDir)).toBe(true);
    expect(readFileSync(join(ownDir, "SKILL.md"), "utf-8")).toBe(originalContent);
  });

  it("preserves the original promote op (append-only) — adds new revert op instead (AC-US3-01)", async () => {
    // Seed OWN + log a prior promote op
    seedOwnSkillWithProvenance("demo");
    await appendOp({
      id: "promote-op-1",
      ts: Date.now() - 1000,
      op: "promote",
      skillId: "p/demo",
      fromScope: "installed",
      toScope: "own",
      actor: "studio-ui",
    });

    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/revert"];

    await handler(fakeReq(), fakeRes(), { plugin: "p", skill: "demo" });

    const ops = await listOps();
    const promote = ops.find((o) => o.id === "promote-op-1");
    const revert = ops.find((o) => o.op === "revert");

    expect(promote).toBeTruthy();
    expect(promote!.op).toBe("promote");
    expect(revert).toBeTruthy();
    expect(revert!.skillId).toBe("p/demo");
    expect(revert!.fromScope).toBe("own");
  });

  it("returns 404 when OWN dir missing", async () => {
    const h = captureHandlers(workRoot, homeRoot);
    const handler = h.post["/api/skills/:plugin/:skill/revert"];

    const res = fakeRes();
    await handler(fakeReq(), res, { plugin: "p", skill: "nonexistent" });

    expect((res as any).captured.status).toBe(404);
  });
});
