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

  it("calls onProgress for each auto-prompt during Phase 1", async () => {
    const client = mockClient([
      // Phase 1: classify 2 auto prompts
      JSON.stringify({ related: true }),
      JSON.stringify({ related: false }),
      // Phase 2: evaluate 2 prompts
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "send a slack message", expected: "auto" },
      { prompt: "write a poem", expected: "auto" },
    ];

    const onProgress = vi.fn();
    await testActivation("desc", prompts, client, undefined, SKILL_META, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, "classifying", 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, "classifying", 2, 2);
  });

  it("does not call onProgress when all prompts have explicit expected", async () => {
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const onProgress = vi.fn();
    await testActivation("desc", PROMPTS, client, undefined, undefined, onProgress);

    expect(onProgress).not.toHaveBeenCalled();
  });

  it("calls onProgress only for auto prompts in mixed array", async () => {
    const client = mockClient([
      // Phase 1: only 1 auto prompt
      JSON.stringify({ related: false }),
      // Phase 2: all 3
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
      JSON.stringify({ activate: false, confidence: "high", reasoning: "No" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "send a slack message", expected: "should_activate" },
      { prompt: "write a poem", expected: "should_not_activate" },
      { prompt: "unlabeled", expected: "auto" },
    ];

    const onProgress = vi.fn();
    await testActivation("desc", prompts, client, undefined, SKILL_META, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith("classifying", 1, 1);
  });

  it("works without onProgress (backward compatible)", async () => {
    const client = mockClient([
      JSON.stringify({ related: true }),
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Yes" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "test", expected: "auto" },
    ];

    // No onProgress — should not throw
    const summary = await testActivation("desc", prompts, client, undefined, SKILL_META);
    expect(summary.total).toBe(1);
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

// ---------------------------------------------------------------------------
// Disagreement-warning tests (increment 0775)
// Auto-classified Phase 1 vs Phase 2 disagreement → scope_warning / drift_warning
// instead of FP / FN. Manual labels stay strict.
// ---------------------------------------------------------------------------

const HELLO_META: SkillMeta = {
  name: "hello-skill",
  tags: [],
};

describe("testActivation — disagreement warnings", () => {
  it("auto-classified scope_warning: Phase 1 says no, Phase 2 says yes", async () => {
    const client = mockClient([
      // Phase 1: classify "how are you today?" with name=hello-skill, tags=[] → not related
      JSON.stringify({ related: false }),
      // Phase 2: evaluate against full description that says "activate for every message" → activate
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Description says activate for every message" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "how are you today?", expected: "auto" },
    ];

    const summary = await testActivation("This skill activates for every user message", prompts, client, undefined, HELLO_META);

    expect(summary.results[0].verdict).toBe("scope_warning");
    expect(summary.results[0].classification).toBe("FP"); // diagnostic info preserved
    expect(summary.results[0].autoClassified).toBe(true);
    expect(summary.scopeWarnings).toBe(1);
    expect(summary.driftWarnings).toBe(0);
    expect(summary.fp).toBe(0); // excluded from fp count
    expect(summary.tp).toBe(0);
  });

  it("auto-classified drift_warning: Phase 1 says yes, Phase 2 says no", async () => {
    const client = mockClient([
      // Phase 1: classify → related (auto labels expected = should_activate)
      JSON.stringify({ related: true }),
      // Phase 2: evaluate against description → does NOT activate
      JSON.stringify({ activate: false, confidence: "high", reasoning: "Description doesn't cover this case" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "send a message", expected: "auto" },
    ];

    const summary = await testActivation("Some narrow description", prompts, client, undefined, {
      name: "messaging-helper",
      tags: ["messaging"],
    });

    expect(summary.results[0].verdict).toBe("drift_warning");
    expect(summary.results[0].classification).toBe("FN");
    expect(summary.results[0].autoClassified).toBe(true);
    expect(summary.driftWarnings).toBe(1);
    expect(summary.scopeWarnings).toBe(0);
    expect(summary.fn).toBe(0); // excluded from fn count
  });

  it("manual disagreement still counts as FP (verdict=ok)", async () => {
    // Manual label `should_not_activate` (no Phase 1 call), Phase 2 activates → real FP
    const client = mockClient([
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Real bug" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "some prompt", expected: "should_not_activate" },
    ];

    const summary = await testActivation("desc", prompts, client, undefined, HELLO_META);

    expect(summary.results[0].verdict).toBe("ok");
    expect(summary.results[0].classification).toBe("FP");
    expect(summary.results[0].autoClassified).toBe(false);
    expect(summary.fp).toBe(1);
    expect(summary.scopeWarnings).toBe(0);
  });

  it("precision denominator excludes warnings", async () => {
    // Mix: 1 manual TP + 1 auto-classified scope_warning.
    // With the new scoring, fp should be 0 (warning is excluded), so precision = 1.0 (not 0.5).
    const client = mockClient([
      // Phase 1 for the auto prompt only → not related
      JSON.stringify({ related: false }),
      // Phase 2 for the manual prompt → activate (expected should_activate → TP)
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Match" }),
      // Phase 2 for the auto prompt → activate (expected should_not_activate → would-be FP, but verdict=scope_warning)
      JSON.stringify({ activate: true, confidence: "high", reasoning: "Description over-claims" }),
    ]);

    const prompts: ActivationPrompt[] = [
      { prompt: "real positive case", expected: "should_activate" },
      { prompt: "broad-scope case", expected: "auto" },
    ];

    const summary = await testActivation("desc that activates broadly", prompts, client, undefined, HELLO_META);

    expect(summary.tp).toBe(1);
    expect(summary.fp).toBe(0); // warning excluded
    expect(summary.scopeWarnings).toBe(1);
    expect(summary.precision).toBe(1); // tp / (tp + fp) = 1 / 1 = 1.0, NOT 0.5
  });
});
