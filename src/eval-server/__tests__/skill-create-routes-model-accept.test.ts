// ---------------------------------------------------------------------------
// 0678 — T-001: POST /api/skills/generate must accept body.provider + body.model,
// validate them against detectAvailableProviders(), and fall back to
// { provider: "claude-cli", model: "sonnet" } only when BOTH are absent.
//
// These tests drive the server-side behavior for AC-US2-01 .. AC-US2-05.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before any import of the module under test
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Track every createLlmClient invocation so tests can assert on the
  // validated { provider, model } pair that actually reaches dispatch.
  const llmCalls: Array<{ provider?: string; model?: string }> = [];

  const createLlmClient = vi.fn((opts?: { provider?: string; model?: string }) => {
    llmCalls.push({ provider: opts?.provider, model: opts?.model });
    return {
      generate: vi.fn(async () => ({
        text: JSON.stringify({
          name: "demo-skill",
          description: "demo",
          model: "sonnet",
          allowedTools: "Read",
          body: "# demo",
        }) + "\n---REASONING---\nok",
      })),
    };
  });

  // Deterministic detectAvailableProviders stub — two providers with known models.
  const detectAvailableProviders = vi.fn(async () => [
    { id: "claude-cli", label: "Claude", available: true, models: [{ id: "sonnet", label: "Sonnet" }] },
    { id: "ollama", label: "Ollama", available: true, models: [{ id: "qwen2.5-coder:7b", label: "qwen2.5-coder" }] },
  ]);

  return { llmCalls, createLlmClient, detectAvailableProviders };
});

vi.mock("../../eval/llm.js", () => ({
  createLlmClient: mocks.createLlmClient,
}));

vi.mock("../../eval/benchmark-history.js", () => ({
  writeHistoryEntry: vi.fn(),
}));

vi.mock("../api-routes.js", () => ({
  detectAvailableProviders: mocks.detectAvailableProviders,
}));

// Import the route registrar AFTER mocks are in place.
const { registerSkillCreateRoutes } = await import("../skill-create-routes.js");

// ---------------------------------------------------------------------------
// Router + req/res harness (pattern matches baseline.test.ts)
// ---------------------------------------------------------------------------

interface Captured {
  get: Record<string, any>;
  post: Record<string, any>;
  put: Record<string, any>;
  delete: Record<string, any>;
}

function captureHandlers(root: string): Captured {
  const handlers: Captured = { get: {}, post: {}, put: {}, delete: {} };
  const fakeRouter: any = {
    get: (p: string, h: any) => { handlers.get[p] = h; },
    post: (p: string, h: any) => { handlers.post[p] = h; },
    put: (p: string, h: any) => { handlers.put[p] = h; },
    delete: (p: string, h: any) => { handlers.delete[p] = h; },
  };
  registerSkillCreateRoutes(fakeRouter, root);
  return handlers;
}

function fakeReq(body: unknown, accept = "application/json"): any {
  const bodyStr = JSON.stringify(body);
  const stream: any = {
    method: "POST",
    url: "/api/skills/generate",
    headers: {
      accept,
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(bodyStr)),
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
  const captured = { body: "", status: 0, headers: {} as Record<string, string> };
  return {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) captured.headers = { ...captured.headers, ...headers };
    },
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
    get capturedHeaders() { return captured.headers; },
  };
}

async function runHandler(handler: any, body: unknown) {
  const req = fakeReq(body);
  const res = fakeRes();
  await handler(req, res, {});
  // Allow Promise.allSettled microtasks to settle
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0678 — POST /api/skills/generate provider/model acceptance", () => {
  let handlers: Captured;

  beforeEach(() => {
    mocks.llmCalls.length = 0;
    mocks.createLlmClient.mockClear();
    mocks.detectAvailableProviders.mockClear();
    handlers = captureHandlers("/tmp/vskill-0678-acc-test");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // AC-US2-01 (a): valid provider+model pair is accepted and reaches dispatch
  it("accepts a valid { provider, model } pair and passes both through to createLlmClient", async () => {
    const handler = handlers.post["/api/skills/generate"];
    expect(handler).toBeDefined();

    const res = await runHandler(handler, {
      prompt: "lint markdown",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
    });

    expect(res.capturedStatus).toBe(200);

    // The body client (first createLlmClient call) must receive the caller's pair
    const bodyCall = mocks.llmCalls.find((c) => c.model === "qwen2.5-coder:7b");
    expect(bodyCall, "expected createLlmClient to be called with user's provider+model").toBeDefined();
    expect(bodyCall!.provider).toBe("ollama");
    expect(bodyCall!.model).toBe("qwen2.5-coder:7b");
  });

  // AC-US2-02 (b): unknown provider → 400 unknown_provider with validProviders
  it("rejects unknown provider with HTTP 400 { error: 'unknown_provider', validProviders }", async () => {
    const handler = handlers.post["/api/skills/generate"];
    const res = await runHandler(handler, {
      prompt: "lint markdown",
      provider: "not-a-real-provider",
    });

    expect(res.capturedStatus).toBe(400);
    const body = JSON.parse(res.capturedBody);
    expect(body.error).toBe("unknown_provider");
    expect(body.validProviders).toEqual(expect.arrayContaining(["claude-cli", "ollama"]));
    // Critically: createLlmClient must NOT have been called — no LLM budget spent
    expect(mocks.createLlmClient).not.toHaveBeenCalled();
  });

  // AC-US2-03 (c): provider valid but model not in provider's list → 400 unknown_model
  it("rejects unknown model with HTTP 400 { error: 'unknown_model', validModels }", async () => {
    const handler = handlers.post["/api/skills/generate"];
    const res = await runHandler(handler, {
      prompt: "lint markdown",
      provider: "ollama",
      model: "not-a-loaded-model",
    });

    expect(res.capturedStatus).toBe(400);
    const body = JSON.parse(res.capturedBody);
    expect(body.error).toBe("unknown_model");
    expect(body.validModels).toEqual(expect.arrayContaining(["qwen2.5-coder:7b"]));
    expect(mocks.createLlmClient).not.toHaveBeenCalled();
  });

  // AC-US2-04 (d): both absent → default claude-cli/sonnet
  it("falls back to { claude-cli, sonnet } when both provider and model are absent", async () => {
    const handler = handlers.post["/api/skills/generate"];
    const res = await runHandler(handler, { prompt: "lint markdown" });

    expect(res.capturedStatus).toBe(200);
    const bodyCall = mocks.llmCalls.find((c) => c.model === "sonnet");
    expect(bodyCall, "expected default sonnet dispatch").toBeDefined();
    expect(bodyCall!.provider).toBe("claude-cli");
    expect(bodyCall!.model).toBe("sonnet");
  });

  // AC-US2-05 (e): provider present, model missing → first model of that provider
  it("when only provider is present, fills model with the first model id of that provider", async () => {
    const handler = handlers.post["/api/skills/generate"];
    const res = await runHandler(handler, {
      prompt: "lint markdown",
      provider: "claude-cli",
    });

    expect(res.capturedStatus).toBe(200);
    const bodyCall = mocks.llmCalls.find((c) => c.provider === "claude-cli" && c.model === "sonnet");
    expect(bodyCall, "expected claude-cli/sonnet when model omitted").toBeDefined();
  });
});
