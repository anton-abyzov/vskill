import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());
const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:util", () => ({
  promisify: (fn: any) => fn,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { createLlmClient } = await import("../llm.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createLlmClient", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // -------------------------------------------------------------------------
  // Provider selection
  // -------------------------------------------------------------------------

  it("defaults to claude-cli provider when no env is set", () => {
    const client = createLlmClient();
    expect(client.model).toBe("claude-cli");
  });

  it("selects anthropic provider when VSKILL_EVAL_PROVIDER=anthropic", () => {
    process.env.VSKILL_EVAL_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    const client = createLlmClient();
    expect(client.model).toBe("claude-sonnet-4-20250514");
  });

  it("selects ollama provider when VSKILL_EVAL_PROVIDER=ollama", () => {
    process.env.VSKILL_EVAL_PROVIDER = "ollama";
    const client = createLlmClient();
    expect(client.model).toBe("llama3.1:8b");
  });

  it("throws on unknown provider", () => {
    process.env.VSKILL_EVAL_PROVIDER = "gpt-magic";
    expect(() => createLlmClient()).toThrow('Unknown VSKILL_EVAL_PROVIDER: "gpt-magic"');
  });

  // -------------------------------------------------------------------------
  // Anthropic provider
  // -------------------------------------------------------------------------

  describe("anthropic provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "anthropic";
      process.env.ANTHROPIC_API_KEY = "test-key";
    });

    it("returns text content on successful generate call", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "Generated response" }],
      });

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result).toBe("Generated response");
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it("uses default model claude-sonnet-4-20250514", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4-20250514" }),
        expect.anything(),
      );
    });

    it("uses custom model from VSKILL_EVAL_MODEL", async () => {
      process.env.VSKILL_EVAL_MODEL = "claude-opus-4-20250514";
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-opus-4-20250514" }),
        expect.anything(),
      );
    });

    it("propagates network error from SDK", async () => {
      mockCreate.mockRejectedValue(new Error("Connection timeout"));

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Connection timeout",
      );
    });

    it("passes system and user prompts correctly", async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });

      const client = createLlmClient();
      await client.generate("my system prompt", "my user prompt");

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "my system prompt",
          messages: [{ role: "user", content: "my user prompt" }],
          max_tokens: 4096,
        }),
        expect.anything(),
      );
    });

    it("throws when ANTHROPIC_API_KEY is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(() => createLlmClient()).toThrow("ANTHROPIC_API_KEY is not set");
    });
  });

  // -------------------------------------------------------------------------
  // Claude CLI provider
  // -------------------------------------------------------------------------

  describe("claude-cli provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "claude-cli";
    });

    it("calls claude CLI with combined prompt", async () => {
      mockExecFile.mockResolvedValue({ stdout: "CLI response\n" });

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result).toBe("CLI response");
      expect(mockExecFile).toHaveBeenCalledWith(
        "claude",
        ["-p", "system prompt\n\nuser prompt", "--no-input"],
        expect.objectContaining({ timeout: 120_000 }),
      );
    });

    it("throws helpful error when claude CLI not found", async () => {
      const err = new Error("ENOENT") as any;
      err.code = "ENOENT";
      mockExecFile.mockRejectedValue(err);

      const client = createLlmClient();
      await expect(client.generate("sys", "usr")).rejects.toThrow(
        "Claude CLI not found",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Ollama provider
  // -------------------------------------------------------------------------

  describe("ollama provider", () => {
    beforeEach(() => {
      process.env.VSKILL_EVAL_PROVIDER = "ollama";
    });

    it("uses default model llama3.1:8b", () => {
      const client = createLlmClient();
      expect(client.model).toBe("llama3.1:8b");
    });

    it("uses custom model from VSKILL_EVAL_MODEL", () => {
      process.env.VSKILL_EVAL_MODEL = "qwen2.5:32b";
      const client = createLlmClient();
      expect(client.model).toBe("qwen2.5:32b");
    });

    it("calls Ollama HTTP API with correct payload", async () => {
      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "Ollama reply" }), { status: 200 }),
      );

      const client = createLlmClient();
      const result = await client.generate("system prompt", "user prompt");

      expect(result).toBe("Ollama reply");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/generate",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"model":"llama3.1:8b"'),
        }),
      );

      mockFetch.mockRestore();
    });

    it("uses custom base URL from OLLAMA_BASE_URL", async () => {
      process.env.OLLAMA_BASE_URL = "http://gpu-server:11434";

      const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ response: "ok" }), { status: 200 }),
      );

      const client = createLlmClient();
      await client.generate("sys", "usr");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://gpu-server:11434/api/generate",
        expect.anything(),
      );

      mockFetch.mockRestore();
    });
  });
});
