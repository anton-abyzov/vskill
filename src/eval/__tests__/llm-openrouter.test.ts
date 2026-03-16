import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch globally for OpenRouter API calls
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());
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
// Helper: create a mock OpenRouter response
// ---------------------------------------------------------------------------

function mockOpenRouterResponse(opts: {
  text?: string;
  totalCost?: number | null;
  promptTokens?: number;
  completionTokens?: number;
  status?: number;
}) {
  const body: any = {
    choices: [{ message: { content: opts.text ?? "Generated text" } }],
    usage: {
      prompt_tokens: opts.promptTokens ?? 50,
      completion_tokens: opts.completionTokens ?? 100,
    },
  };
  if (opts.totalCost !== undefined && opts.totalCost !== null) {
    body.usage.total_cost = opts.totalCost;
  }

  return new Response(JSON.stringify(body), { status: opts.status ?? 200 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenRouter provider", () => {
  const origEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // TC-030: Missing API key throws descriptive error
  // -------------------------------------------------------------------------

  it("throws when OPENROUTER_API_KEY is not set", () => {
    expect(() => createLlmClient({ provider: "openrouter" })).toThrow("OPENROUTER_API_KEY");
  });

  it("error message contains setup URL", () => {
    expect(() => createLlmClient({ provider: "openrouter" })).toThrow(
      "https://openrouter.ai/keys",
    );
  });

  // -------------------------------------------------------------------------
  // TC-028: Client sends to correct URL
  // -------------------------------------------------------------------------

  it("sends request to openrouter.ai/api/v1/chat/completions", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok" }));

    const client = createLlmClient({ provider: "openrouter" });
    await client.generate("system", "user");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // -------------------------------------------------------------------------
  // TC-029: Model ID passed as-is
  // -------------------------------------------------------------------------

  it("passes model ID as-is in request body", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok" }));

    const client = createLlmClient({
      provider: "openrouter",
      model: "meta-llama/llama-3.1-70b-instruct",
    });
    await client.generate("system", "user");

    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.model).toBe("meta-llama/llama-3.1-70b-instruct");
  });

  // -------------------------------------------------------------------------
  // TC-059: Correct request structure
  // -------------------------------------------------------------------------

  it("includes Authorization header and required OpenRouter headers", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-123";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok" }));

    const client = createLlmClient({ provider: "openrouter" });
    await client.generate("system prompt", "user prompt");

    const callArgs = fetchSpy.mock.calls[0];
    const headers = callArgs[1]!.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key-123");
    expect(headers["HTTP-Referer"]).toBeDefined();
    expect(headers["X-Title"]).toBeDefined();
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends system and user messages in OpenAI format", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok" }));

    const client = createLlmClient({ provider: "openrouter" });
    await client.generate("my system", "my user");

    const callArgs = fetchSpy.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "my system" },
      { role: "user", content: "my user" },
    ]);
    expect(body.max_tokens).toBe(4096);
  });

  // -------------------------------------------------------------------------
  // TC-031: Cost extracted from response
  // -------------------------------------------------------------------------

  it("extracts cost from usage.total_cost", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok", totalCost: 0.0025 }));

    const client = createLlmClient({ provider: "openrouter" });
    const result = await client.generate("system", "user");

    expect(result.cost).toBe(0.0025);
  });

  // -------------------------------------------------------------------------
  // TC-032: Missing total_cost yields null
  // -------------------------------------------------------------------------

  it("returns null cost when usage.total_cost is absent", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(mockOpenRouterResponse({ text: "ok", totalCost: null }));

    const client = createLlmClient({ provider: "openrouter" });
    const result = await client.generate("system", "user");

    expect(result.cost).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TC-060: Full response parsing
  // -------------------------------------------------------------------------

  it("parses text, tokens, duration, and cost from response", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(
      mockOpenRouterResponse({
        text: "Hello world",
        totalCost: 0.01,
        promptTokens: 100,
        completionTokens: 200,
      }),
    );

    const client = createLlmClient({ provider: "openrouter" });
    const result = await client.generate("system", "user");

    expect(result.text).toBe("Hello world");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(200);
    expect(result.cost).toBe(0.01);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Default model
  // -------------------------------------------------------------------------

  it("uses default model anthropic/claude-sonnet-4", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const client = createLlmClient({ provider: "openrouter" });
    expect(client.model).toBe("anthropic/claude-sonnet-4");
  });

  it("uses custom model from VSKILL_EVAL_MODEL", () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.VSKILL_EVAL_MODEL = "google/gemini-2.5-pro";
    const client = createLlmClient({ provider: "openrouter" });
    expect(client.model).toBe("google/gemini-2.5-pro");
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it("throws on non-200 response with status and body", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    fetchSpy.mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    const client = createLlmClient({ provider: "openrouter" });
    await expect(client.generate("system", "user")).rejects.toThrow(
      "OpenRouter request failed (401)",
    );
  });

  // -------------------------------------------------------------------------
  // ProviderName includes openrouter
  // -------------------------------------------------------------------------

  it("openrouter is selectable via VSKILL_EVAL_PROVIDER env var", () => {
    process.env.VSKILL_EVAL_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "test-key";
    const client = createLlmClient();
    expect(client.model).toBe("anthropic/claude-sonnet-4");
  });

  // -------------------------------------------------------------------------
  // cost field on non-openrouter providers is null
  // -------------------------------------------------------------------------

  it("non-openrouter providers return cost: null", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    // Ollama provider
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ response: "ok" }), { status: 200 }),
    );
    const client = createLlmClient({ provider: "ollama" });
    const result = await client.generate("system", "user");
    expect(result.cost).toBeNull();
  });
});
