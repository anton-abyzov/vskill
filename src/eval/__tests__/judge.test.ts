import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Assertion } from "../schema.js";
import type { LlmClient } from "../llm.js";
import { judgeAssertion } from "../judge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockResult(text: string) {
  return { text, durationMs: 100, inputTokens: null, outputTokens: null };
}

function mockClient(response: string): LlmClient {
  return { generate: vi.fn().mockResolvedValue(mockResult(response)), model: "test-model" };
}

const ASSERTION: Assertion = {
  id: "assert-1",
  text: "Output mentions a file path",
  type: "boolean",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("judgeAssertion", () => {
  it("returns pass result when LLM judge says pass", async () => {
    const client = mockClient(
      JSON.stringify({ pass: true, reasoning: "output contains file path" }),
    );

    const result = await judgeAssertion(
      "The report has been saved to reports/q1.csv",
      ASSERTION,
      client,
    );

    expect(result.pass).toBe(true);
    expect(result.reasoning).toBe("output contains file path");
    expect(result.id).toBe("assert-1");
    expect(result.text).toBe("Output mentions a file path");
  });

  it("returns fail result when LLM judge says fail", async () => {
    const client = mockClient(
      JSON.stringify({
        pass: false,
        reasoning: "no file path found in output",
      }),
    );

    const result = await judgeAssertion("Hello world", ASSERTION, client);

    expect(result.pass).toBe(false);
    expect(result.reasoning).toBe("no file path found in output");
  });

  it("throws on malformed judge response", async () => {
    const client = mockClient("This is not JSON");

    await expect(
      judgeAssertion("some output", ASSERTION, client),
    ).rejects.toThrow(/invalid judge output/i);
  });

  it("handles JSON wrapped in code fence", async () => {
    const client = mockClient(
      '```json\n{"pass": true, "reasoning": "looks good"}\n```',
    );

    const result = await judgeAssertion("some output", ASSERTION, client);
    expect(result.pass).toBe(true);
  });
});
