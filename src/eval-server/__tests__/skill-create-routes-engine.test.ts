// ---------------------------------------------------------------------------
// 0734 — POST /api/skills/create with new `engine` field.
// Tests AC-US3-01..05 + AC-US3-06 (metadata.engine in frontmatter).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const detectionMock = vi.hoisted(() => ({ skillCreatorInstalled: false, skillCreatorPath: "", generate: vi.fn(), universal: vi.fn() }));

vi.mock("../../utils/skill-creator-detection.js", () => ({
  isSkillCreatorInstalled: () => detectionMock.skillCreatorInstalled,
  findSkillCreatorPath: () => detectionMock.skillCreatorPath,
}));

vi.mock("../../core/skill-generator.js", () => ({ generateSkill: detectionMock.universal }));

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: vi.fn(() => ({ generate: detectionMock.generate })),
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

async function runHandler(handler: any, body: unknown, sse = false) {
  const req = fakeReq(body);
  if (sse) req.headers.accept = "text/event-stream";
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
    detectionMock.skillCreatorPath = join(root, "engine");
    mkdirSync(detectionMock.skillCreatorPath);
    writeFileSync(join(detectionMock.skillCreatorPath, "SKILL.md"), "# Installed skill-creator instructions\nUse the custom Claude-native schema.");
    detectionMock.generate.mockResolvedValue({ text: '---\nname: demo-skill\ndescription: "Demo skill"\ncontext: fork\nagent: Explore\nallowed-tools: [Read, "Bash(git status:*)"]\nmetadata:\n  custom: preserved\n---\n# Native result\n' });
    detectionMock.universal.mockResolvedValue({ name: "universal", description: "Portable", model: "", allowedTools: "", body: "Portable body", evals: [], reasoning: "fixture" });
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
    expect(detectionMock.generate).toHaveBeenCalledTimes(1);
    expect(detectionMock.generate.mock.calls[0][0]).toContain("Installed skill-creator instructions");
    expect(skillMd).toContain("context: fork");
    expect(skillMd).toContain("agent: Explore");
    expect(skillMd).toContain("custom: preserved");
    expect(skillMd).toContain("# Native result");
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
  it("AC-US3-04: engine='none' skips generation and emits the body verbatim with explicit unassisted provenance", async () => {
    const handler = handlers.post["/api/skills/create"];

    const rawBody = "\n  # Raw\n\n  spaces stay  \n\n";
    const res = await runHandler(handler, baseRequest({ engine: "none", body: rawBody }));
    expect(res.capturedStatus).toBe(201);

    const result = JSON.parse(res.capturedBody);
    const skillMd = readFileSync(result.skillMdPath, "utf8");
    expect(skillMd).toMatch(/engine:\s*none/);
    expect(skillMd.split("---\n").slice(2).join("---\n").slice(1)).toBe(rawBody);
    expect(detectionMock.generate).not.toHaveBeenCalled();
  });

  // ---- AC-US3-05 (defensive) ---------------------------------------------
  it("AC-US3-05: invalid engine value → 400 with validation error", async () => {
    const handler = handlers.post["/api/skills/create"];

    const res = await runHandler(handler, baseRequest({ engine: "garbage-engine" }));
    expect(res.capturedStatus).toBe(400);

    const result = JSON.parse(res.capturedBody);
    expect(result.error).toMatch(/engine/i);
  });
  it("routes native generation to installed instructions and universal generation to its existing generator", async () => {
    const universal = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Portable", engine: "vskill", targetAgents: ["codex"] });
    expect(universal.capturedStatus).toBe(200);
    expect(detectionMock.universal).toHaveBeenCalledWith(expect.objectContaining({ targetAgents: ["codex"] }), expect.anything());
    expect(detectionMock.generate).not.toHaveBeenCalled();
    detectionMock.skillCreatorInstalled = true;
    const native = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Native", engine: "anthropic-skill-creator", targetAgents: ["codex"] });
    expect(native.capturedStatus).toBe(200);
    expect(JSON.parse(native.capturedBody)).toMatchObject({ engine: "anthropic-skill-creator", emittedTargets: ["claude-code"], nativeSkillMd: expect.stringContaining("context: fork") });
    expect(detectionMock.generate).toHaveBeenCalledOnce();
    expect(detectionMock.universal).toHaveBeenCalledOnce();
  });
  it("rejects none generation and a non-Claude provider for the native engine without making model calls", async () => {
    detectionMock.skillCreatorInstalled = true;
    for (const request of [{ engine: "none" }, { engine: "anthropic-skill-creator", provider: "codex-cli" }]) {
      const res = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Must not run", ...request });
      expect(res.capturedStatus).toBe(400);
    }
    expect(detectionMock.generate).not.toHaveBeenCalled();
    expect(detectionMock.universal).not.toHaveBeenCalled();
  });
  it("saves a native preview without regenerating or dropping custom frontmatter", async () => {
    detectionMock.skillCreatorInstalled = true;
    const preview = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Native", engine: "anthropic-skill-creator" });
    const generated = JSON.parse(preview.capturedBody);
    const saved = await runHandler(handlers.post["/api/skills/create"], baseRequest({ ...generated, version: "2.0.0", targetAgents: ["codex"] }));
    expect(saved.capturedStatus).toBe(201);
    expect(detectionMock.generate).toHaveBeenCalledOnce();
    const content = readFileSync(JSON.parse(saved.capturedBody).skillMdPath, "utf8");
    expect(content).toContain("custom: preserved");
    expect(content).toContain("target-agents: [claude-code]");
    expect(content).not.toContain("[codex]");
  });
  it("streams native documents and errors without switching generators", async () => {
    detectionMock.skillCreatorInstalled = true;
    const generated = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Native", engine: "anthropic-skill-creator" }, true);
    expect(generated.capturedBody).toContain("event: done");
    expect(generated.capturedBody).toContain('"emittedTargets":["claude-code"]');
    detectionMock.generate.mockRejectedValueOnce(new Error("native engine failed"));
    const failure = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Native", engine: "anthropic-skill-creator" }, true);
    expect(failure.capturedBody).toContain("event: error");
    expect(failure.capturedBody).toContain("native engine failed");
    detectionMock.generate.mockRejectedValueOnce(new Error("native engine failed"));
    const jsonFailure = await runHandler(handlers.post["/api/skills/generate"], { prompt: "Native", engine: "anthropic-skill-creator" });
    expect(jsonFailure.capturedStatus).toBe(500);
    expect(detectionMock.universal).not.toHaveBeenCalled();
  });
  it("autosaves native drafts without regeneration and refuses update of a nonexistent skill", async () => {
    const nativeSkillMd = '---\nname: demo-skill\ndescription: Demo\ncontext: fork\n---\nNative body';
    const draft = await runHandler(handlers.post["/api/skills/save-draft"], baseRequest({ nativeSkillMd, engine: "anthropic-skill-creator", aiMeta: { prompt: "Native", provider: "claude-cli", model: "sonnet", reasoning: "fixture" } }));
    expect(draft.capturedStatus).toBe(201);
    const content = readFileSync(join(root, "demo-plugin", "skills", "demo-skill", "SKILL.md"), "utf8");
    expect(content).toContain("context: fork");
    expect(content).toContain("engine: anthropic-skill-creator");
    expect(detectionMock.generate).not.toHaveBeenCalled();
    const missing = await runHandler(handlers.post["/api/skills/create"], baseRequest({ name: "missing", mode: "update" }));
    expect(missing.capturedStatus).toBe(404);
  });

});
