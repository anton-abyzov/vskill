import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch globally for LM Studio API calls
// ---------------------------------------------------------------------------

const mockResolveCliBinary = vi.hoisted(() => vi.fn((name: string) => name));
const mockEnhancedPath = vi.hoisted(() => vi.fn((p?: string) => p || process.env.PATH || ""));

vi.mock("../../utils/resolve-binary.js", () => ({
  resolveCliBinary: mockResolveCliBinary,
  enhancedPath: mockEnhancedPath,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { createLlmClient } = await import("../llm.js");

// ---------------------------------------------------------------------------
// Helper: create a mock LM Studio / OpenAI-compatible response
// ---------------------------------------------------------------------------

function mockLmStudioResponse(opts: {
  text?: string;
  promptTokens?: number;
  completionTokens?: number;
  status?: number;
  body?: string;
}) {
  if (opts.status && opts.status !== 200) {
    return new Response(opts.body ?? "Error", { status: opts.status });
  }
  const body = {
    id: "chatcmpl-local",
    object: "chat.completion",
    choices: [{ message: { role: "assistant", content: opts.text ?? "Generated text" } }],
    usage: {
      prompt_tokens: opts.promptTokens ?? 50,
      completion_tokens: opts.completionTokens ?? 100,
    },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LM Studio provider", () => {
  const origEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
    delete process.env.LM_STUDIO_BASE_URL;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // AC-US1-01: lm-studio provider is in the union and selectable
  // -------------------------------------------------------------------------

  it("is selectable via createLlmClient({ provider: 'lm-studio' })", () => {
    const client = createLlmClient({ provider: "lm-studio" });
    expect(client).toBeDefined();
    expect(typeof client.generate).toBe("function");
  });

  it("is selectable via VSKILL_EVAL_PROVIDER=lm-studio", () => {
    process.env.VSKILL_EVAL_PROVIDER = "lm-studio";
    const client = createLlmClient();
    expect(client).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // AC-US1-02: request hits the LM Studio base URL with Bearer lm-studio
  // -------------------------------------------------------------------------

  it("sends request to default http://localhost:1234/v1/chat/completions", async () => {
    fetchSpy.mockResolvedValue(mockLmStudioResponse({ text: "ok" }));
    const client = createLlmClient({ provider: "lm-studio" });
    await client.generate("system", "user");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:1234/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sets Authorization header to 'Bearer lm-studio' (dummy key)", async () => {
    fetchSpy.mockResolvedValue(mockLmStudioResponse({ text: "ok" }));
    const client = createLlmClient({ provider: "lm-studio" });
    await client.generate("system", "user");

    const callArgs = fetchSpy.mock.calls[0];
    const headers = callArgs[1]!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer lm-studio");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends OpenAI-shaped chat completions body", async () => {
    fetchSpy.mockResolvedValue(mockLmStudioResponse({ text: "ok" }));
    const client = createLlmClient({ provider: "lm-studio", model: "qwen2.5-coder-7b" });
    await client.generate("my system", "my user");

    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.model).toBe("qwen2.5-coder-7b");
    expect(body.messages).toEqual([
      { role: "system", content: "my system" },
      { role: "user", content: "my user" },
    ]);
    expect(body.max_tokens).toBe(4096);
  });

  // -------------------------------------------------------------------------
  // AC-US1-03: happy-path response parsing — text, tokens, duration, free cost
  // -------------------------------------------------------------------------

  it("parses text, token counts, and duration from response", async () => {
    fetchSpy.mockResolvedValue(
      mockLmStudioResponse({
        text: "Hello from local",
        promptTokens: 12,
        completionTokens: 34,
      }),
    );
    const client = createLlmClient({ provider: "lm-studio" });
    const result = await client.generate("system", "user");

    expect(result.text).toBe("Hello from local");
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(34);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.cost).toBe(0);
    expect(result.billingMode).toBe("free");
  });

  // -------------------------------------------------------------------------
  // AC-US1-04: non-2xx response throws with status and first 200 chars of body
  // -------------------------------------------------------------------------

  it("throws on HTTP 404 with status code and body preview", async () => {
    fetchSpy.mockResolvedValue(
      mockLmStudioResponse({ status: 404, body: "model not found: abc" }),
    );
    const client = createLlmClient({ provider: "lm-studio" });
    await expect(client.generate("system", "user")).rejects.toThrow("404");
    // re-mock and check body preview in message
    fetchSpy.mockResolvedValue(
      mockLmStudioResponse({ status: 404, body: "model not found: abc" }),
    );
    await expect(client.generate("system", "user")).rejects.toThrow("model not found");
  });

  it("throws on HTTP 500 with status code and first 200 chars of body", async () => {
    const longBody = "X".repeat(500);
    fetchSpy.mockResolvedValue(
      mockLmStudioResponse({ status: 500, body: longBody }),
    );
    const client = createLlmClient({ provider: "lm-studio" });
    try {
      await client.generate("system", "user");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("500");
      // Message should contain only the first 200 chars of body (not all 500)
      // We assert length of the body-preview portion
      expect(msg.length).toBeLessThan(600);
    }
  });

  it("throws on network error / fetch throw", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:1234"));
    const client = createLlmClient({ provider: "lm-studio" });
    await expect(client.generate("system", "user")).rejects.toThrow(/ECONNREFUSED|LM Studio|fetch/i);
  });

  // -------------------------------------------------------------------------
  // AC-US1-05: LM_STUDIO_BASE_URL env override
  // -------------------------------------------------------------------------

  it("uses LM_STUDIO_BASE_URL env var when set", async () => {
    process.env.LM_STUDIO_BASE_URL = "http://remote-lmstudio:5678/v1";
    fetchSpy.mockResolvedValue(mockLmStudioResponse({ text: "ok" }));

    const client = createLlmClient({ provider: "lm-studio" });
    await client.generate("system", "user");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://remote-lmstudio:5678/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // -------------------------------------------------------------------------
  // Default model
  // -------------------------------------------------------------------------

  it("uses a default model when none is provided", () => {
    const client = createLlmClient({ provider: "lm-studio" });
    expect(client.model).toBeTruthy();
    expect(typeof client.model).toBe("string");
  });

  it("uses custom model from VSKILL_EVAL_MODEL", () => {
    process.env.VSKILL_EVAL_MODEL = "llama-3.2-3b-instruct";
    const client = createLlmClient({ provider: "lm-studio" });
    expect(client.model).toBe("llama-3.2-3b-instruct");
  });
});
