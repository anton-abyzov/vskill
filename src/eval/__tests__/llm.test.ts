import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
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
    process.env.ANTHROPIC_API_KEY = "test-key";
    delete process.env.VSKILL_EVAL_MODEL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
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

  it("uses default model claude-sonnet-4-20250514 when env not set", async () => {
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

  it("uses custom model from VSKILL_EVAL_MODEL env var", async () => {
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

  it("exposes model name on the client", () => {
    const client = createLlmClient();
    expect(client.model).toBe("claude-sonnet-4-20250514");
  });

  it("exposes custom model name when VSKILL_EVAL_MODEL is set", () => {
    process.env.VSKILL_EVAL_MODEL = "claude-opus-4-20250514";
    const client = createLlmClient();
    expect(client.model).toBe("claude-opus-4-20250514");
  });
});
