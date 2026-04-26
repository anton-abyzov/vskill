// ---------------------------------------------------------------------------
// 0772 US-004 — 409 from POST /api/skills/create returns a structured payload
// (`code`, `plugin`, `skill`, `dir`) so the client can recover by navigating
// to the existing skill instead of showing a red error banner.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

interface Captured {
  post: Record<string, (req: unknown, res: unknown) => Promise<void>>;
}

function captureHandlers(root: string): Captured {
  const handlers: Captured = { post: {} };
  const fakeRouter = {
    get: () => {},
    post: (p: string, h: (req: unknown, res: unknown) => Promise<void>) => {
      handlers.post[p] = h;
    },
    put: () => {},
    delete: () => {},
  } as unknown as Parameters<typeof registerSkillCreateRoutes>[0];
  registerSkillCreateRoutes(fakeRouter, root);
  return handlers;
}

function fakeReq(body: unknown): unknown {
  const bodyStr = JSON.stringify(body);
  const stream = {
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

function fakeRes() {
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

async function runHandler(
  handler: (req: unknown, res: unknown) => Promise<void>,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = fakeReq(body);
  const res = fakeRes();
  await handler(req, res);
  await new Promise((r) => setImmediate(r));
  return { status: res.capturedStatus, body: JSON.parse(res.capturedBody) };
}

describe("POST /api/skills/create — 409 structured payload (0772 US-004)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vskill-409-payload-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("AC-US4-02: 409 carries `code`, `plugin`, `skill`, `dir` fields", async () => {
    // Pre-create the skill so the handler hits the 409 branch.
    const skillDir = join(root, "skills", "hello-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: hi\n---\n");

    const handlers = captureHandlers(root);
    const handler = handlers.post["/api/skills/create"];
    const { status, body } = await runHandler(handler, {
      name: "hello-skill",
      description: "Hello",
      layout: 3,
      plugin: "",
    });

    expect(status).toBe(409);
    expect(body.code).toBe("skill-already-exists");
    expect(body.plugin).toBeDefined();
    expect(body.skill).toBe("hello-skill");
    expect(typeof body.dir).toBe("string");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("already exists");
  });
});
