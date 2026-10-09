import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const anthropicCreate = vi.hoisted(() => vi.fn());
const openaiCreate = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: anthropicCreate }; } }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: openaiCreate } }; } }));

import { createLlmClient } from "../llm.js";
import { PROVIDER_MODELS, CURRENT_OPENAI_MODELS } from "../model-catalog.js";
import { calculateCost } from "../pricing.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  vi.stubEnv("VSKILL_EVAL_MODEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit current Anthropic models", () => {
  it.each(["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"])(
    "%s keeps model identity and receives a thinking-aware output budget", async (model) => {
      anthropicCreate.mockResolvedValue({
        content: [{ type: "thinking", thinking: "" }, { type: "text", text: "first" }, { type: "text", text: " second" }],
        stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 50 },
      });
      const client = createLlmClient({ provider: "anthropic", model });
      const result = await client.generate("system", "test prompt");
      const request = anthropicCreate.mock.calls[0][0];
      expect(client.model).toBe(model);
      expect(request).toMatchObject({ model, max_tokens: 16_384, output_config: { effort: "medium" } });
      expect(request).not.toHaveProperty("thinking");
      expect(request).not.toHaveProperty("temperature");
      expect(result.text).toBe("first second");
      expect(result.cost).toBeGreaterThan(0);
      expect(PROVIDER_MODELS.anthropic.some((m) => m.id === model)).toBe(true);
      expect(PROVIDER_MODELS["claude-cli"].some((m) => m.id === model)).toBe(true);
    },
  );

  it.each(["max_tokens", "model_context_window_exceeded", "refusal"])(
    "does not accept a %s response as successful skill/test generation", async (stop_reason) => {
      anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '{"partial":' }], stop_reason });
      const client = createLlmClient({ provider: "anthropic", model: "claude-opus-5-5" });
      await expect(client.generate("system", "prompt")).rejects.toThrow(/truncated|refusal/);
    },
  );

  it("rejects a thinking-only response rather than saving empty test output", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "thinking", thinking: "" }], stop_reason: "end_turn" });
    await expect(createLlmClient({ provider: "anthropic", model: "claude-opus-5-5" }).generate("s", "u"))
      .rejects.toThrow("returned no text");
  });
});

describe("explicit current OpenAI models", () => {
  it.each(CURRENT_OPENAI_MODELS.map((m) => m.id))("%s uses a completion-token budget without changing default", async (model) => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    const result = await createLlmClient({ provider: "openai", model }).generate("s", "u");
    const request = openaiCreate.mock.calls[0][0];
    expect(request).toMatchObject({ model, max_completion_tokens: 16_384, reasoning_effort: "medium" });
    expect(request).not.toHaveProperty("max_tokens");
    expect(result.text).toBe("ok");
    expect(result.cost).toBeGreaterThan(0);
    expect(PROVIDER_MODELS.openai.some((m) => m.id === model)).toBe(true);
    expect(PROVIDER_MODELS["codex-cli"].some((m) => m.id === model)).toBe(true);
  });

  it.each([
    { message: { content: "partial" }, finish_reason: "length" },
    { message: { content: "", refusal: "Request refused" }, finish_reason: "stop" },
    { message: { content: "" }, finish_reason: "content_filter" },
    { message: { content: null }, finish_reason: "stop" },
  ])("rejects incomplete or refused response %#", async (choice) => {
    openaiCreate.mockResolvedValue({ choices: [choice] });
    await expect(createLlmClient({ provider: "openai", model: "gpt-6.1-sol" }).generate("s", "u"))
      .rejects.toThrow(/truncated|refusal|no text/);
  });
});

describe("published standard pricing tiers", () => {
  it("charges Haiku 5.5 full-request long-context rates only above 100K input", () => {
    expect(calculateCost("anthropic", "claude-haiku-5-5", 100_000, 1000)).toBeCloseTo(0.0105);
    expect(calculateCost("anthropic", "claude-haiku-5-5", 100_001, 1000)).toBeCloseTo(0.0525005);
  });
  it("charges GPT-6.1 Sol full-request rates only above 272K input", () => {
    expect(calculateCost("openai", "gpt-6.1-sol", 272_000, 1000)).toBeCloseTo(0.554);
    expect(calculateCost("openai", "gpt-6.1-sol", 272_001, 1000)).toBeCloseTo(1.103004);
  });
  it("preserves previous provider defaults", () => {
    expect(PROVIDER_MODELS.anthropic[0].id).toBe("claude-opus-4-8");
    expect(PROVIDER_MODELS["claude-cli"][0].id).toBe("opus");
    expect(PROVIDER_MODELS.openai[0].id).toBe("gpt-4o-mini");
    expect(PROVIDER_MODELS["codex-cli"][0].id).toBe("o3");
  });
});
