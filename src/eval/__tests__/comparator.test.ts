import { describe, it, expect, vi } from "vitest";
import {
  generateComparisonOutputs,
  scoreComparison,
  runComparison,
} from "../comparator.js";
import type { LlmClient } from "../llm.js";
import type { McpDependency } from "../mcp-detector.js";

function mockClient(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    model: "test-model",
    generate: vi.fn(async () => {
      const text = responses[callIndex++] ?? "";
      return { text, durationMs: 100, inputTokens: 50, outputTokens: 100 };
    }),
  };
}

describe("generateComparisonOutputs", () => {
  it("generates skill and baseline outputs sequentially", async () => {
    const client = mockClient(["skill response", "baseline response"]);
    const result = await generateComparisonOutputs("test prompt", "# Skill Content", client);

    expect(result.skillOutput).toBe("skill response");
    expect(result.baselineOutput).toBe("baseline response");
    expect(result.skillDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.baselineDurationMs).toBeGreaterThanOrEqual(0);
    expect(client.generate).toHaveBeenCalledTimes(2);

    // First call should include skill content
    const firstCall = (client.generate as any).mock.calls[0];
    expect(firstCall[0]).toContain("Skill Content");

    // Second call should be generic
    const secondCall = (client.generate as any).mock.calls[1];
    expect(secondCall[0]).toContain("helpful AI assistant");
  });
});

describe("scoreComparison", () => {
  it("parses JSON scores from LLM response", async () => {
    const client = mockClient([
      JSON.stringify({
        content_score_a: 4,
        structure_score_a: 3,
        content_score_b: 5,
        structure_score_b: 4,
        winner: "second",
        reasoning: "B is better",
      }),
    ]);

    const result = await scoreComparison("output A", "output B", "prompt", client);
    expect(result.contentScoreA).toBe(4);
    expect(result.structureScoreA).toBe(3);
    expect(result.contentScoreB).toBe(5);
    expect(result.structureScoreB).toBe(4);
    expect(result.winner).toBe("second");
  });

  it("parses JSON from code fence", async () => {
    const client = mockClient([
      '```json\n{"content_score_a": 3, "structure_score_a": 3, "content_score_b": 3, "structure_score_b": 3, "winner": "tie"}\n```',
    ]);

    const result = await scoreComparison("A", "B", "p", client);
    expect(result.winner).toBe("tie");
    expect(result.contentScoreA).toBe(3);
  });

  it("clamps scores to 1-5 range", async () => {
    const client = mockClient([
      JSON.stringify({
        content_score_a: 0,
        structure_score_a: 10,
        content_score_b: -1,
        structure_score_b: 6,
        winner: "first",
      }),
    ]);

    const result = await scoreComparison("A", "B", "p", client);
    expect(result.contentScoreA).toBe(1);
    expect(result.structureScoreA).toBe(5);
    expect(result.contentScoreB).toBe(1);
    expect(result.structureScoreB).toBe(5);
  });

  it("defaults invalid winner to tie", async () => {
    const client = mockClient([
      JSON.stringify({
        content_score_a: 3,
        structure_score_a: 3,
        content_score_b: 3,
        structure_score_b: 3,
        winner: "invalid",
      }),
    ]);

    const result = await scoreComparison("A", "B", "p", client);
    expect(result.winner).toBe("tie");
  });
});

describe("runComparison", () => {
  it("maps scores back to skill/baseline correctly", async () => {
    // Mock: first two calls = skill + baseline outputs, third = scoring
    const client = mockClient([
      "skill output here",
      "baseline output here",
      JSON.stringify({
        content_score_a: 4,
        structure_score_a: 5,
        content_score_b: 2,
        structure_score_b: 3,
        winner: "first",
        reasoning: "A is better",
      }),
    ]);

    // Fix randomness for deterministic test
    vi.spyOn(Math, "random").mockReturnValue(0.3); // < 0.5 → skill is A

    const result = await runComparison("test prompt", "skill content", client);

    expect(result.prompt).toBe("test prompt");
    expect(result.skillOutput).toBe("skill output here");
    expect(result.baselineOutput).toBe("baseline output here");
    // skill is A, so scores map directly
    expect(result.skillContentScore).toBe(4);
    expect(result.skillStructureScore).toBe(5);
    expect(result.baselineContentScore).toBe(2);
    expect(result.baselineStructureScore).toBe(3);
    expect(result.winner).toBe("skill");

    vi.restoreAllMocks();
  });

  it("maps scores correctly when baseline is A", async () => {
    const client = mockClient([
      "skill out",
      "baseline out",
      JSON.stringify({
        content_score_a: 2,
        structure_score_a: 2,
        content_score_b: 4,
        structure_score_b: 4,
        winner: "second",
      }),
    ]);

    // > 0.5 → skill is B
    vi.spyOn(Math, "random").mockReturnValue(0.7);

    const result = await runComparison("p", "s", client);
    // skill is B → scores.contentScoreB is skill
    expect(result.skillContentScore).toBe(4);
    expect(result.baselineContentScore).toBe(2);
    // winner "second" = B = skill
    expect(result.winner).toBe("skill");

    vi.restoreAllMocks();
  });
});

describe("scoreComparison with MCP deps", () => {
  it("uses standard prompt when no MCP deps", async () => {
    const client = mockClient([
      JSON.stringify({
        content_score_a: 3,
        structure_score_a: 3,
        content_score_b: 3,
        structure_score_b: 3,
        winner: "tie",
      }),
    ]);

    await scoreComparison("A", "B", "prompt", client);

    const systemPrompt = (client.generate as any).mock.calls[0][0];
    expect(systemPrompt).not.toContain("SIMULATED MCP");
  });

  it("augments prompt when MCP deps present", async () => {
    const client = mockClient([
      JSON.stringify({
        content_score_a: 3,
        structure_score_a: 3,
        content_score_b: 3,
        structure_score_b: 3,
        winner: "tie",
      }),
    ]);

    const mcpDeps: McpDependency[] = [
      {
        server: "Slack",
        url: "https://mcp.slack.com/mcp",
        transport: "http",
        matchedTools: ["slack_send_message"],
        configSnippet: "{}",
      },
    ];

    await scoreComparison("A", "B", "prompt", client, mcpDeps);

    const systemPrompt = (client.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain("SIMULATED MCP");
    expect(systemPrompt).toContain("Slack");
  });
});

describe("runComparison with MCP auto-detection", () => {
  it("auto-detects MCP deps from skill content and augments comparison", async () => {
    const client = mockClient([
      "skill output",
      "baseline output",
      JSON.stringify({
        content_score_a: 3,
        structure_score_a: 3,
        content_score_b: 3,
        structure_score_b: 3,
        winner: "tie",
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0.3);

    await runComparison("prompt", "Use slack_send_message to send messages.", client);

    // The third call is the scoring call - check its system prompt
    const scoringCall = (client.generate as any).mock.calls[2];
    expect(scoringCall[0]).toContain("SIMULATED MCP");
    expect(scoringCall[0]).toContain("Slack");

    vi.restoreAllMocks();
  });

  it("does not augment comparison for non-MCP skills", async () => {
    const client = mockClient([
      "skill output",
      "baseline output",
      JSON.stringify({
        content_score_a: 3,
        structure_score_a: 3,
        content_score_b: 3,
        structure_score_b: 3,
        winner: "tie",
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0.3);

    await runComparison("prompt", "Plain text skill without MCP.", client);

    const scoringCall = (client.generate as any).mock.calls[2];
    expect(scoringCall[0]).not.toContain("SIMULATED MCP");

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// TC-005: Parallel skill+baseline generation
// ---------------------------------------------------------------------------

describe("generateComparisonOutputs parallel mode", () => {
  it("runs skill and baseline concurrently when parallel=true (TC-005)", async () => {
    const callTimestamps: number[] = [];

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (_sys: string, _user: string) => {
        callTimestamps.push(Date.now());
        await new Promise((r) => setTimeout(r, 50));
        return { text: "output", durationMs: 50, inputTokens: 10, outputTokens: 20 };
      }),
    };

    const result = await generateComparisonOutputs("prompt", "skill content", client, undefined, { parallel: true });

    expect(result.skillOutput).toBe("output");
    expect(result.baselineOutput).toBe("output");
    expect(client.generate).toHaveBeenCalledTimes(2);

    // Both calls should start within 10ms of each other (concurrent)
    expect(Math.abs(callTimestamps[0] - callTimestamps[1])).toBeLessThan(20);
  });

  it("runs sequentially when parallel is false/undefined", async () => {
    const callTimestamps: number[] = [];

    const client: LlmClient = {
      model: "test-model",
      generate: vi.fn(async (_sys: string, _user: string) => {
        callTimestamps.push(Date.now());
        await new Promise((r) => setTimeout(r, 30));
        return { text: "output", durationMs: 30, inputTokens: 10, outputTokens: 20 };
      }),
    };

    await generateComparisonOutputs("prompt", "skill content", client);

    // Second call should start after first completes (~30ms gap)
    expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThanOrEqual(25);
  });
});

describe("generateComparisonOutputs with onProgress", () => {
  it("calls onProgress with generating_skill before first LLM call", async () => {
    const client = mockClient(["skill response", "baseline response"]);
    const onProgress = vi.fn();

    await generateComparisonOutputs("test prompt", "# Skill", client, onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, "generating_skill", "Generating skill output...");
  });

  it("calls onProgress with generating_baseline before second LLM call", async () => {
    const client = mockClient(["skill response", "baseline response"]);
    const onProgress = vi.fn();

    await generateComparisonOutputs("test prompt", "# Skill", client, onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(2, "generating_baseline", "Generating baseline output...");
  });

  it("calls onProgress exactly 2 times", async () => {
    const client = mockClient(["skill response", "baseline response"]);
    const onProgress = vi.fn();

    await generateComparisonOutputs("test prompt", "# Skill", client, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it("works without onProgress (backward compatible)", async () => {
    const client = mockClient(["skill response", "baseline response"]);

    const result = await generateComparisonOutputs("test prompt", "# Skill", client);

    expect(result.skillOutput).toBe("skill response");
    expect(result.baselineOutput).toBe("baseline response");
  });
});

describe("runComparison with onProgress", () => {
  it("calls onProgress for all 3 phases in order", async () => {
    const client = mockClient([
      "skill output",
      "baseline output",
      JSON.stringify({
        content_score_a: 3, structure_score_a: 3,
        content_score_b: 3, structure_score_b: 3,
        winner: "tie",
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0.3);
    const onProgress = vi.fn();

    await runComparison("prompt", "skill content", client, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[0][0]).toBe("generating_skill");
    expect(onProgress.mock.calls[1][0]).toBe("generating_baseline");
    expect(onProgress.mock.calls[2][0]).toBe("scoring");

    vi.restoreAllMocks();
  });

  it("completes without error when onProgress is omitted", async () => {
    const client = mockClient([
      "skill",
      "baseline",
      JSON.stringify({
        content_score_a: 3, structure_score_a: 3,
        content_score_b: 3, structure_score_b: 3,
        winner: "tie",
      }),
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0.3);

    const result = await runComparison("prompt", "skill", client);

    expect(result.winner).toBe("tie");
    expect(result.skillOutput).toBe("skill");

    vi.restoreAllMocks();
  });
});
