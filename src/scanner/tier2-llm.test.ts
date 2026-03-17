import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTier2Scan, type AIBinding } from "./tier2-llm.js";

function makeAI(responses: Array<{ response?: string } | Error>): AIBinding {
  let callIndex = 0;
  return {
    run: vi.fn(async () => {
      const item = responses[callIndex++];
      if (item instanceof Error) throw item;
      return item;
    }),
  };
}

const validResponse = JSON.stringify({
  score: 90,
  verdict: "PASS",
  rationale: "All clear.",
});

describe("runTier2Scan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns parsed result on success", async () => {
    const ai = makeAI([{ response: validResponse }]);

    const result = await runTier2Scan("# Safe skill", [], ai);

    expect(result.score).toBe(90);
    expect(result.verdict).toBe("PASS");
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure and succeeds", async () => {
    const ai = makeAI([
      new Error("fetch failed"),
      { response: validResponse },
    ]);

    const promise = runTier2Scan("# Skill", [], ai);

    // Advance past the 1s backoff (attempt 1 -> retry after 1000ms)
    await vi.advanceTimersByTimeAsync(1500);

    const result = await promise;

    expect(result.score).toBe(90);
    expect(result.verdict).toBe("PASS");
    expect(ai.run).toHaveBeenCalledTimes(2);
  });

  it("returns FAIL after all retries exhausted", async () => {
    const ai = makeAI([
      new Error("fetch failed"),
      new Error("timeout"),
      new Error("connection reset"),
    ]);

    const promise = runTier2Scan("# Skill", [], ai);

    // Advance past all backoffs: 1s + 2s
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;

    expect(result.score).toBe(0);
    expect(result.verdict).toBe("FAIL");
    expect(result.rationale).toContain("after 3 attempts");
    expect(result.rationale).toContain("connection reset");
    expect(ai.run).toHaveBeenCalledTimes(3);
  });

  it("returns conservative score 0 when LLM response is unparseable", async () => {
    const ai = makeAI([{ response: "not json at all" }]);

    const result = await runTier2Scan("# Skill", [], ai);

    expect(result.score).toBe(0);
    expect(result.verdict).toBe("FAIL");
    expect(result.rationale).toContain("Failed to parse");
  });

  it("clamps score to 0-100 range", async () => {
    const ai = makeAI([{
      response: JSON.stringify({ score: 150, verdict: "PASS", rationale: "Very safe" }),
    }]);

    const result = await runTier2Scan("# Skill", [], ai);

    expect(result.score).toBe(100);
  });
});
