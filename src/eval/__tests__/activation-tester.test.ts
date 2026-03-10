import { describe, it, expect, vi } from "vitest";
import { testActivation } from "../activation-tester.js";
import type { ActivationPrompt, SkillMeta } from "../activation-tester.js";
import type { LlmClient } from "../llm.js";

function mockClient(responses: string[]): LlmClient {
  let i = 0;
  return {
    model: "test-model",
    generate: vi.fn(async () => {
      const text = responses[i++] ?? "";
      return { text, durationMs: 100, inputTokens: null, outputTokens: null };
    }),
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

// ---------------------------------------------------------------------------
// Auto-classification tests
// ---------------------------------------------------------------------------

const SKILL_META: SkillMeta = {
  name: "slack-messaging",
  tags: ["slack", "messaging", "channels", "threads"],
};

describe("testActivation — auto-classification", () => {
  it("auto-classifies prompts using skill name and tags", async () => {
    const client = mockClient([
      // Phase 1: classify "send a message in #general" → related
      JSON.stringify({ related: true }),
      // Phase 1: classify "I built my test" → not related
      JSON.stringify({ related: false }),
      // Phase 2: evaluate "send a message in #general" → activate
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Slack messaging" }),
      // Phase 2: evaluate "I built my test" → no activate
      JSON.stringify({ activate: false, confidence: "high", reasoning: "Software testing" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "send a message in #general", expected: "auto" },
      { prompt: "I built my test", expected: "auto" },
    ];

    const summary = await testActivation("Slack messaging skill desc", prompts, client, undefined, SKILL_META);

    expect(summary.tp).toBe(1);
    expect(summary.tn).toBe(1);
    expect(summary.fp).toBe(0);
    expect(summary.fn).toBe(0);
    expect(summary.autoClassifiedCount).toBe(2);
    expect(summary.results[0].autoClassified).toBe(true);
    expect(summary.results[0].expected).toBe("should_activate");
    expect(summary.results[1].autoClassified).toBe(true);
    expect(summary.results[1].expected).toBe("should_not_activate");
  });

  it("preserves manual labels when mixed with auto", async () => {
    const client = mockClient([
      // Phase 1: only the auto prompt gets classified → not related
      JSON.stringify({ related: false }),
      // Phase 2: evaluate all three
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "send a slack message", expected: "should_activate" },
      { prompt: "write a poem", expected: "should_not_activate" },
      { prompt: "some unlabeled prompt", expected: "auto" },
    ];

    const summary = await testActivation("desc", prompts, client, undefined, SKILL_META);

    expect(summary.autoClassifiedCount).toBe(1);
    expect(summary.results[0].autoClassified).toBe(false);
    expect(summary.results[0].expected).toBe("should_activate");
    expect(summary.results[1].autoClassified).toBe(false);
    expect(summary.results[1].expected).toBe("should_not_activate");
    expect(summary.results[2].autoClassified).toBe(true);
    expect(summary.results[2].expected).toBe("should_not_activate");
  });

  it("falls back to should_activate when auto without meta", async () => {
    const client = mockClient([
      // No Phase 1 call — straight to Phase 2
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "some prompt", expected: "auto" },
    ];

    // No meta passed
    const summary = await testActivation("desc", prompts, client);

    expect(summary.results[0].expected).toBe("should_activate");
    expect(summary.results[0].autoClassified).toBe(true);
    expect(summary.results[0].classification).toBe("TP");
  });

  it("falls back to should_activate when classification LLM call fails", async () => {
    let callCount = 0;
    const client: LlmClient = {
      model: "test",
      generate: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("classification failed");
        // Phase 2: normal response
        return {
          text: JSON.stringify({ activate: true, confidence: "high", reasoning: "yes" }),
          durationMs: 100, inputTokens: null, outputTokens: null,
        };
      }),
    };

    const prompts: ActivationPrompt[] = [
      { prompt: "some prompt", expected: "auto" },
    ];

    const summary = await testActivation("desc", prompts, client, undefined, SKILL_META);

    expect(summary.results[0].expected).toBe("should_activate");
    expect(summary.results[0].autoClassified).toBe(true);
    expect(summary.results[0].classification).toBe("TP");
  });

  it("existing tests with explicit expected still work without meta", async () => {
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const summary = await testActivation("desc", PROMPTS, client);

    // No auto-classification, backward compatible
    expect(summary.autoClassifiedCount).toBe(0);
    expect(summary.results[0].autoClassified).toBe(false);
    expect(summary.results[1].autoClassified).toBe(false);
  });
});
