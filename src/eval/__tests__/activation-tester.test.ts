import { describe, it, expect, vi } from "vitest";
import { testActivation } from "../activation-tester.js";
import type { ActivationPrompt } from "../activation-tester.js";
import type { LlmClient } from "../llm.js";

function mockClient(responses: string[]): LlmClient {
  let i = 0;
  return {
    model: "test-model",
    generate: vi.fn(async () => responses[i++] ?? ""),
  };
}

const PROMPTS: ActivationPrompt[] = [
  { prompt: "How do I write a test?", expected: "should_activate" },
  { prompt: "What is the weather?", expected: "should_not_activate" },
];

describe("testActivation", () => {
  it("classifies TP correctly (should activate, does activate)", async () => {
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Test-related" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "Not related" }),
    ]);

    const summary = await testActivation("Test skill description", PROMPTS, client);
    expect(summary.tp).toBe(1);
    expect(summary.tn).toBe(1);
    expect(summary.fp).toBe(0);
    expect(summary.fn).toBe(0);
    expect(summary.precision).toBe(1);
    expect(summary.recall).toBe(1);
    expect(summary.reliability).toBe(1);
    expect(summary.total).toBe(2);
  });

  it("classifies FP correctly (should not activate, does activate)", async () => {
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "medium", reasoning: "Yes" }),
      JSON.stringify({ activate: true, confidence: "low", reasoning: "Wrongly activated" }),
    ]);

    const summary = await testActivation("desc", PROMPTS, client);
    expect(summary.tp).toBe(1);
    expect(summary.fp).toBe(1);
    expect(summary.precision).toBe(0.5);
    expect(summary.recall).toBe(1);
  });

  it("classifies FN correctly (should activate, does not)", async () => {
    const client = mockClient([
      JSON.stringify({ activate: false, confidence: "high", reasoning: "Missed" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "Correct" }),
    ]);

    const summary = await testActivation("desc", PROMPTS, client);
    expect(summary.fn).toBe(1);
    expect(summary.tn).toBe(1);
    expect(summary.recall).toBe(0);
  });

  it("handles LLM errors gracefully", async () => {
    const client: LlmClient = {
      model: "test",
      generate: vi.fn(async () => {
        throw new Error("LLM timeout");
      }),
    };

    const summary = await testActivation("desc", PROMPTS, client);
    expect(summary.total).toBe(2);
    // On error: activate=false, so should_activate → FN, should_not_activate → TN
    expect(summary.fn).toBe(1);
    expect(summary.tn).toBe(1);
    expect(summary.results[0].reasoning).toContain("LLM timeout");
  });

  it("calls onResult callback for each prompt", async () => {
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const results: any[] = [];
    await testActivation("desc", PROMPTS, client, (r) => results.push(r));
    expect(results).toHaveLength(2);
    expect(results[0].classification).toBe("TP");
    expect(results[1].classification).toBe("TN");
  });

  it("parses JSON from code fence responses", async () => {
    const client = mockClient([
      '```json\n{"activate": true, "confidence": "medium", "reasoning": "Looks relevant"}\n```',
      '```\n{"activate": false, "confidence": "low", "reasoning": "Not relevant"}\n```',
    ]);

    const summary = await testActivation("desc", PROMPTS, client);
    expect(summary.tp).toBe(1);
    expect(summary.tn).toBe(1);
  });

  it("handles empty prompts array", async () => {
    const client = mockClient([]);
    const summary = await testActivation("desc", [], client);
    expect(summary.total).toBe(0);
    expect(summary.precision).toBe(0);
    expect(summary.recall).toBe(0);
    expect(summary.reliability).toBe(0);
  });
});
