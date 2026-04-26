// ---------------------------------------------------------------------------
// 0734 — POST /api/skills/create with new `engine` field.
// Tests AC-US3-01..05 + AC-US3-06 (metadata.engine in frontmatter).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const detectionMock = vi.hoisted(() => ({ skillCreatorInstalled: false }));

vi.mock("../../utils/skill-creator-detection.js", () => ({
  isSkillCreatorInstalled: () => detectionMock.skillCreatorInstalled,
  findSkillCreatorPath: () => null,
}));

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: vi.fn(),
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(async () => {}),
}));

const { registerSkillCreateRoutes } = await import("../skill-create-routes.js");

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Captured {
  post: Record<string, any>;
}

function captureHandlers(root: string): Captured {
  const handlers: Captured = { post: {} };
  const fakeRouter: any = {
    get: () => {},
    post: (p: string, h: any) => { handlers.post[p] = h; },
    put: () => {},
    delete: () => {},
  };
  registerSkillCreateRoutes(fakeRouter, root);
  return handlers;
}

function fakeReq(body: unknown): any {
  const bodyStr = JSON.stringify(body);
  const stream: any = {
    method: "POST",
    url: "/api/skills/create",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(bodyStr)),
      host: "127.0.0.1:3077",
    },
    on: (event: string, callback: (chunk?: Buffer) => void) => {
      if (event === "data") setImmediate(() => callback(Buffer.from(bodyStr)));
      else if (event === "end") setImmediate(() => callback());
      return stream;
    },
  };
  return stream;
}

function fakeRes(): any {
  const captured = { body: "", status: 0 };
  return {
    writeHead(status: number) { captured.status = status; },
    write(chunk: string | Buffer) {
      captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    end(chunk?: string | Buffer) {
      if (chunk) captured.body += typeof chunk === "string" ? chunk : chunk.toString();
    },
    headersSent: false,
    on: vi.fn(),
    setHeader: vi.fn(),
    get capturedBody() { return captured.body; },
    get capturedStatus() { return captured.status; },
  };
}

async function runHandler(handler: any, body: unknown) {
  const req = fakeReq(body);
  const res = fakeRes();
  await handler(req, res, {});
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return res;
}

function baseRequest(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "demo-skill",
    plugin: "demo-plugin",
    layout: 1,
    description: "Demo skill",
    body: "# Demo\n\nHello world.",
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0734 — engine field on POST /api/skills/create", () => {
  let root: string;
  let handlers: Captured;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vskill-0734-engine-"));
    detectionMock.skillCreatorInstalled = false;
    handlers = captureHandlers(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // ---- AC-US3-01 + AC-US3-06 -----------------------------------------------
  it("AC-US3-01: defaults engine to 'vskill' when omitted; AC-US3-06: persists metadata.engine in frontmatter", async () => {
    const handler = handlers.post["/api/skills/create"];
    expect(handler).toBeDefined();

    const res = await runHandler(handler, baseRequest());
    expect(res.capturedStatus).toBe(201);

    const result = JSON.parse(res.capturedBody);
    const skillMd = readFileSync(result.skillMdPath, "utf8");
    expect(skillMd).toMatch(/engine:\s*vskill/);
  });

  // ---- AC-US3-02 -----------------------------------------------------------
  it("AC-US3-02: engine='vskill' continues to call universal generator (no behavior change)", async () => {
    const handler = handlers.post["/api/skills/create"];
    const res = await runHandler(handler, baseRequest({ engine: "vskill" }));
    expect(res.capturedStatus).toBe(201);

    const result = JSON.parse(res.capturedBody);
    const skillMd = readFileSync(result.skillMdPath, "utf8");
    expect(skillMd).toMatch(/engine:\s*vskill/);
    // The body content is preserved verbatim — universal generator doesn't rewrite it.
    expect(skillMd).toContain("Hello world.");
  });

  // ---- AC-US3-03 (success path) -------------------------------------------
  it("AC-US3-03: engine='anthropic-skill-creator' + plugin installed → 201 with Claude-only emission", async () => {
    detectionMock.skillCreatorInstalled = true;
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, baseRequest({ engine: "anthropic-skill-creator" }));
    expect(res.capturedStatus).toBe(201);

    const result = JSON.parse(res.capturedBody);
    expect(result.engine).toBe("anthropic-skill-creator");
    expect(result.emittedTargets).toEqual(["claude-code"]);

    const skillMd = readFileSync(result.skillMdPath, "utf8");
    expect(skillMd).toMatch(/engine:\s*anthropic-skill-creator/);
  });

  // ---- AC-US3-03 (failure path) -------------------------------------------
  it("AC-US3-03: engine='anthropic-skill-creator' + plugin NOT installed → 400 with remediation", async () => {
    detectionMock.skillCreatorInstalled = false;
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, baseRequest({ engine: "anthropic-skill-creator" }));
    expect(res.capturedStatus).toBe(400);

    const result = JSON.parse(res.capturedBody);
    expect(result.error).toBe("skill-creator-not-installed");
    expect(result.remediation).toBe("claude plugin install skill-creator");
  });

  // ---- AC-US3-04 -----------------------------------------------------------
  it("AC-US3-04: engine='none' skips generation and emits the body verbatim with no metadata.engine", async () => {
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, baseRequest({ engine: "none" }));
    expect(res.capturedStatus).toBe(201);

    const result = JSON.parse(res.capturedBody);
    const skillMd = readFileSync(result.skillMdPath, "utf8");
    expect(skillMd).not.toMatch(/^\s*engine:/m);
    expect(skillMd).toContain("Hello world.");
  });

  // ---- AC-US3-05 (defensive) ---------------------------------------------
  it("AC-US3-05: invalid engine value → 400 with validation error", async () => {
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, baseRequest({ engine: "garbage-engine" }));
    expect(res.capturedStatus).toBe(400);

    const result = JSON.parse(res.capturedBody);
    expect(result.error).toMatch(/engine/i);
  });
});
