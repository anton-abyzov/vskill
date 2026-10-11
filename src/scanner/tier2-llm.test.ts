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

describe("runTier2Scan: answers without the required critical validation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const content = "const r = eval(userInput);";
  const critical = [{ severity: "critical" as const, category: "code-execution", message: "eval()", line: 1, patternId: "CE-001" }];
  const validated = JSON.stringify({
    score: 92,
    verdict: "PASS",
    rationale: "Fixture.",
    criticalValidation: [{ patternId: "CE-001", verdict: "false_positive", reason: "test fixture" }],
  });

  it("asks once more, then fails without a usable verdict", async () => {
    const ai = makeAI([{ response: validResponse }, { response: validResponse }, { response: validated }]);
    const result = await runTier2Scan(content, critical, ai);
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ score: 0, verdict: "FAIL" });
    expect(result.rationale).toContain("did not validate critical finding(s) CE-001");
    expect(result.concerns).toEqual(["Reviewer did not validate critical finding(s): CE-001"]);
  });

  it("accepts a retry that validates", async () => {
    const ai = makeAI([{ response: validResponse }, { response: validated }]);
    const result = await runTier2Scan(content, critical, ai);
    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ score: 92, verdict: "PASS" });
  });

  it("does not spend a transient-failure retry on the missing validation", async () => {
    const ai = makeAI([new Error("fetch failed"), { response: validResponse }, new Error("timeout"), { response: validated }]);
    const promise = runTier2Scan(content, critical, ai);
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(ai.run).toHaveBeenCalledTimes(4);
    expect(result.score).toBe(92);
  });

  it("does not retry when nothing critical is listed", async () => {
    const ai = makeAI([{ response: validResponse }, { response: validated }]);
    const result = await runTier2Scan("# Safe skill", [], ai);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(result.score).toBe(90);
  });

  it("requires criticalValidation in the response schema only when criticals are listed", async () => {
    const ai = makeAI([{ response: validated }, { response: validResponse }]);
    await runTier2Scan(content, critical, ai);
    await runTier2Scan("# Safe skill", [], ai);
    const inputs = (ai.run as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1] as { json_schema: { required: string[] }; response_format: unknown });
    expect(inputs[0].json_schema.required).toContain("criticalValidation");
    expect(inputs[1].json_schema.required).not.toContain("criticalValidation");
    expect(inputs[0].response_format).toEqual({ type: "json_object" });
  });
});
