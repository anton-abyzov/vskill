// ---------------------------------------------------------------------------
// T-015 [TDD-RED] — ops routes integration tests
// AC-US4-04 (SSE op events prepended live on subscribe)
// AC-US4-05 (paginated GET /api/studio/ops?before=&limit=)
// + DELETE /api/studio/ops/:id tombstones + subsequent list excludes.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerOpsRoutes } from "../ops.js";
import { appendOp } from "../../lib/ops-log.js";
import type { StudioOp } from "../../types.js";

interface Captured {
  get: Record<string, any>;
  post: Record<string, any>;
  put: Record<string, any>;
  delete: Record<string, any>;
}

function captureHandlers(): Captured {
  const handlers: Captured = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter: any = {
    get: (p: string, h: any) => { handlers.get[p] = h; },
    post: (p: string, h: any) => { handlers.post[p] = h; },
    put: (p: string, h: any) => { handlers.put[p] = h; },
    delete: (p: string, h: any) => { handlers.delete[p] = h; },
  };
  registerOpsRoutes(fakeRouter);
  return handlers;
}

function fakeReq(url: string, method = "GET"): any {
  return {
    method,
    url,
    headers: { accept: "application/json" },
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

function makeOp(partial: Partial<StudioOp> = {}): StudioOp {
  return {
    id: partial.id ?? `op-${Math.random().toString(36).slice(2, 10)}`,
    ts: partial.ts ?? Date.now(),
    op: partial.op ?? "promote",
    skillId: "p/demo",
    fromScope: "installed",
    toScope: "own",
    actor: "studio-ui",
    ...partial,
  };
}

let logDir: string;

beforeEach(() => {
  logDir = join(tmpdir(), `vskill-ops-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(logDir, { recursive: true });
  process.env.VSKILL_OPS_LOG_PATH = join(logDir, "studio-ops.jsonl");
});

afterEach(() => {
  try { rmSync(logDir, { recursive: true, force: true }); } catch {}
});

describe("registerOpsRoutes", () => {
  it("registers GET /api/studio/ops, GET /api/studio/ops/stream, DELETE /api/studio/ops/:id", () => {
    const h = captureHandlers();
    expect(h.get["/api/studio/ops"]).toBeDefined();
    expect(h.get["/api/studio/ops/stream"]).toBeDefined();
    expect(h.delete["/api/studio/ops/:id"]).toBeDefined();
  });

  it("GET /api/studio/ops?limit=5 returns at most 5 newest-first ops as JSON", async () => {
    for (let i = 0; i < 8; i++) {
      await appendOp(makeOp({ id: `op-${i}`, ts: i + 1 }));
    }
    const h = captureHandlers();
    const res = fakeRes();
    await h.get["/api/studio/ops"](fakeReq("/api/studio/ops?limit=5"), res, {});

    expect((res as any).captured.status).toBe(200);
    const body = JSON.parse((res as any).captured.body);
    expect(Array.isArray(body.ops)).toBe(true);
    expect(body.ops).toHaveLength(5);
    expect(body.ops.map((o: any) => o.id)).toEqual(["op-7", "op-6", "op-5", "op-4", "op-3"]);
  });

  it("GET /api/studio/ops?before=<ts>&limit=<n> paginates (AC-US4-05)", async () => {
    for (let i = 0; i < 8; i++) await appendOp(makeOp({ id: `op-${i}`, ts: i + 1 }));
    const h = captureHandlers();
    const res = fakeRes();
    await h.get["/api/studio/ops"](fakeReq("/api/studio/ops?before=5&limit=3"), res, {});

    const body = JSON.parse((res as any).captured.body);
    expect(body.ops.map((o: any) => o.id)).toEqual(["op-3", "op-2", "op-1"]);
  });

  it("DELETE /api/studio/ops/:id tombstones — subsequent list excludes it", async () => {
    await appendOp(makeOp({ id: "keep", ts: 1 }));
    await appendOp(makeOp({ id: "drop", ts: 2 }));

    const h = captureHandlers();
    const delRes = fakeRes();
    await h.delete["/api/studio/ops/:id"](fakeReq("/api/studio/ops/drop", "DELETE"), delRes, { id: "drop" });

    expect((delRes as any).captured.status).toBe(200);

    const listRes = fakeRes();
    await h.get["/api/studio/ops"](fakeReq("/api/studio/ops"), listRes, {});
    const body = JSON.parse((listRes as any).captured.body);
    expect(body.ops.map((o: any) => o.id)).toEqual(["keep"]);
  });

  it("GET /api/studio/ops/stream emits SSE 'op' events when appendOp fires (AC-US4-04)", async () => {
    const h = captureHandlers();
    const res = fakeRes();

    // Start the SSE stream.
    const streamPromise = h.get["/api/studio/ops/stream"](
      fakeReq("/api/studio/ops/stream"),
      res,
      {},
    );

    // Give handler a tick to wire subscription, then append.
    await new Promise((r) => setImmediate(r));
    await appendOp(makeOp({ id: "live-1", ts: 100 }));

    // Allow emit to propagate + close the stream so the handler returns.
    await new Promise((r) => setImmediate(r));

    // Simulate client disconnect — the handler wires a close handler via res.on;
    // we unwire manually by asserting the body so far, then letting GC handle.
    const body = (res as any).captured.body;
    expect(body).toContain("event: op");
    expect(body).toContain('"id":"live-1"');

    // Clean up: don't await streamPromise since it only resolves on req close.
    void streamPromise;
  });

  it("GET /api/studio/ops/stream writes SSE headers", async () => {
    const h = captureHandlers();
    const res = fakeRes();
    void h.get["/api/studio/ops/stream"](fakeReq("/api/studio/ops/stream"), res, {});
    await new Promise((r) => setImmediate(r));
    expect((res as any).captured.headers["Content-Type"]).toBe("text/event-stream");
  });
});
