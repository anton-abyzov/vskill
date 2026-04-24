// ---------------------------------------------------------------------------
// llm-openai.test.ts — T-022 (0702 Phase 2).
//
// Contract: a new "openai" provider parallel to "anthropic"/"openrouter".
//   - Reads OPENAI_API_KEY from process.env.
//   - Missing key → descriptive error that includes the env var name and
//     the issuance URL (https://platform.openai.com/api-keys).
//   - generate(system, user) → GenerateResult { text, durationMs, ... }.
//   - Model default "gpt-4o-mini" (cheap default). VSKILL_EVAL_MODEL override.
//   - Never logs the raw key; errors do not echo it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = {
      completions: { create: mockCreate },
    };
  },
}));

const { createLlmClient } = await import("../llm.js");

describe("createLlmClient({ provider: 'openai' })", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VSKILL_EVAL_PROVIDER;
    delete process.env.VSKILL_EVAL_MODEL;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("TC-017: throws when OPENAI_API_KEY is not set — with actionable message", () => {
    expect(() => createLlmClient({ provider: "openai" })).toThrow(/OPENAI_API_KEY/);
    expect(() => createLlmClient({ provider: "openai" })).toThrow(/platform\.openai\.com/);
  });

  it("TC-016: generate() returns text from mocked SDK response", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-xxx-UNIQUESUB9Y";
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hello from gpt" } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    });
    const client = createLlmClient({ provider: "openai", model: "gpt-4o-mini" });
    const result = await client.generate("sys", "user");
    expect(result.text).toBe("hello from gpt");
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(7);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // SDK call received system + user
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const firstCall = mockCreate.mock.calls[0][0];
    expect(firstCall.model).toBe("gpt-4o-mini");
    expect(firstCall.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
  });

  it("uses default model gpt-4o-mini when no override set", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-default-model";
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = createLlmClient({ provider: "openai" });
    expect(client.model).toBe("gpt-4o-mini");
    await client.generate("s", "u");
    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o-mini");
  });

  it("respects VSKILL_EVAL_MODEL override", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-env-model";
    process.env.VSKILL_EVAL_MODEL = "gpt-4o";
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = createLlmClient({ provider: "openai" });
    expect(client.model).toBe("gpt-4o");
    await client.generate("s", "u");
    expect(mockCreate.mock.calls[0][0].model).toBe("gpt-4o");
  });

  it("never echoes raw key in error messages on SDK failure", async () => {
    process.env.OPENAI_API_KEY = "sk-proj-UNIQUESUB9Y-raw-secret";
    mockCreate.mockRejectedValue(new Error("upstream boom"));
    const client = createLlmClient({ provider: "openai" });
    await expect(client.generate("s", "u")).rejects.toThrow();
    try {
      await client.generate("s", "u");
    } catch (err) {
      expect(String(err)).not.toContain("UNIQUESUB9Y");
      expect(String((err as Error).message)).not.toContain("UNIQUESUB9Y");
    }
  });
});
