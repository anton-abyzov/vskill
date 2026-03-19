import { describe, it, expect } from "vitest";
import { computeVerdict, verdictColor, verdictExplanation, verdictLabel } from "../verdict.js";

describe("computeVerdict", () => {
  it("returns EFFECTIVE when passRate >= 0.8 and skill rubric > baseline + 1", () => {
    expect(computeVerdict(0.85, 4.5, 3.0)).toBe("EFFECTIVE");
    expect(computeVerdict(0.80, 4.0, 2.5)).toBe("EFFECTIVE");
    expect(computeVerdict(1.0, 5.0, 1.0)).toBe("EFFECTIVE");
  });

  it("returns MARGINAL when passRate >= 0.6 and skill rubric > baseline (but not EFFECTIVE)", () => {
    expect(computeVerdict(0.70, 3.5, 3.0)).toBe("MARGINAL");
    expect(computeVerdict(0.60, 2.5, 2.0)).toBe("MARGINAL");
    // High pass rate but rubric only slightly better → MARGINAL
    expect(computeVerdict(0.85, 3.5, 3.0)).toBe("MARGINAL");
  });

  it("returns INEFFECTIVE when medium passRate but no improvement over baseline", () => {
    // 50% skill, 60% baseline → no improvement → INEFFECTIVE
    expect(computeVerdict(0.50, 2.5, 3.0, 0.6)).toBe("INEFFECTIVE");
    // 55% skill, 55% baseline → no improvement → INEFFECTIVE
    expect(computeVerdict(0.55, 3.0, 3.0, 0.55)).toBe("INEFFECTIVE");
  });

  it("returns EMERGING when passRate < 0.4 and skillAvg > baselineAvg", () => {
    // Classic case: baseline=0, skill has some score
    expect(computeVerdict(0.33, 5.0, 0.0)).toBe("EMERGING");
    // Skill slightly outperforms baseline but low pass rate
    expect(computeVerdict(0.20, 3.0, 2.0)).toBe("EMERGING");
    expect(computeVerdict(0.10, 2.5, 1.0)).toBe("EMERGING");
    // Just barely above baseline
    expect(computeVerdict(0.39, 5.0, 1.0)).toBe("EMERGING");
  });

  it("returns DEGRADING when passRate < 0.4 and skillAvg <= baselineAvg", () => {
    expect(computeVerdict(0.30, 2.0, 3.0)).toBe("DEGRADING");
    expect(computeVerdict(0.10, 1.0, 1.0)).toBe("DEGRADING");
    expect(computeVerdict(0.0, 0.0, 0.0)).toBe("DEGRADING");
    // Skill worse than baseline
    expect(computeVerdict(0.20, 1.0, 2.0)).toBe("DEGRADING");
  });

  it("handles boundary at passRate = 0.4 (low zone)", () => {
    // 0.4 is below 0.5 → falls to low pass rate zone
    // Equal rubric → DEGRADING
    expect(computeVerdict(0.4, 3.0, 3.0)).toBe("DEGRADING");
    // Skill rubric better → EMERGING
    expect(computeVerdict(0.4, 5.0, 0.0)).toBe("EMERGING");
    // Skill rubric worse → DEGRADING
    expect(computeVerdict(0.4, 1.0, 5.0)).toBe("DEGRADING");
  });

  it("handles boundary at passRate = 0.6", () => {
    // Exactly 0.6 with baselinePassRate=0 (default): passRateDelta=0.6 > 0 → MARGINAL
    expect(computeVerdict(0.6, 3.1, 3.0)).toBe("MARGINAL");
    expect(computeVerdict(0.6, 3.0, 3.0)).toBe("MARGINAL");
    // Exactly 0.6 with baseline also 0.6: no improvement → INEFFECTIVE
    expect(computeVerdict(0.6, 3.0, 3.0, 0.6)).toBe("INEFFECTIVE");
  });

  it("handles boundary at passRate = 0.8", () => {
    // 0.8 pass rate, rubric diff > 1 → EFFECTIVE
    expect(computeVerdict(0.8, 4.0, 2.9)).toBe("EFFECTIVE");
    // 0.8 pass rate but rubric diff exactly 1 → NOT EFFECTIVE (needs >1)
    expect(computeVerdict(0.8, 4.0, 3.0)).toBe("MARGINAL");
  });

  it("skillAvg == baselineAvg with low passRate → DEGRADING (not EMERGING)", () => {
    expect(computeVerdict(0.30, 3.0, 3.0)).toBe("DEGRADING");
    expect(computeVerdict(0.0, 0.0, 0.0)).toBe("DEGRADING");
    expect(computeVerdict(0.39, 2.5, 2.5)).toBe("DEGRADING");
  });

  // --- Baseline-aware verdict tests (4th param: baselinePassRate) ---

  it("EFFECTIVE when skill pass rate high AND significantly better than baseline", () => {
    // 100% skill, 50% baseline, good rubric delta → EFFECTIVE
    expect(computeVerdict(1.0, 4.5, 2.5, 0.5)).toBe("EFFECTIVE");
    // 85% skill, 60% baseline, rubric > baseline + 1 → EFFECTIVE
    expect(computeVerdict(0.85, 4.5, 3.0, 0.6)).toBe("EFFECTIVE");
  });

  it("MARGINAL when skill pass rate high but baseline also high (no improvement)", () => {
    // 80% skill, 80% baseline — skill shows no improvement
    expect(computeVerdict(0.8, 3.5, 3.5, 0.8)).toBe("MARGINAL");
    // 90% skill, 85% baseline — slight improvement only
    expect(computeVerdict(0.9, 4.0, 3.8, 0.85)).toBe("MARGINAL");
  });

  it("DEGRADING when skill pass rate much worse than baseline", () => {
    // 30% skill, 70% baseline — skill is clearly worse
    expect(computeVerdict(0.3, 2.0, 4.0, 0.7)).toBe("DEGRADING");
  });

  it("never returns INEFFECTIVE for assertionPassRate >= 0.8", () => {
    // Even with bad rubric and equal baseline, high pass rate should NOT be INEFFECTIVE
    expect(computeVerdict(0.8, 3.0, 3.0, 0.8)).not.toBe("INEFFECTIVE");
    expect(computeVerdict(1.0, 2.0, 3.0, 1.0)).not.toBe("INEFFECTIVE");
    expect(computeVerdict(0.85, 1.0, 5.0, 0.85)).not.toBe("INEFFECTIVE");
  });

  it("INEFFECTIVE when moderate pass rate but no improvement over baseline", () => {
    // 50% skill, 60% baseline — skill doesn't help
    expect(computeVerdict(0.5, 3.0, 3.5, 0.6)).toBe("INEFFECTIVE");
    // 60% skill, 70% baseline, rubric equal — no improvement
    expect(computeVerdict(0.6, 3.0, 3.0, 0.7)).toBe("INEFFECTIVE");
  });

  it("backwards compatible: 3-arg calls default baselinePassRate to 0", () => {
    // Old-style calls should still work (baselinePassRate defaults to 0)
    expect(computeVerdict(0.85, 4.5, 3.0)).toBe("EFFECTIVE");
    expect(computeVerdict(0.70, 3.5, 3.0)).toBe("MARGINAL");
    expect(computeVerdict(0.0, 0.0, 0.0)).toBe("DEGRADING");
  });
});

describe("verdictColor", () => {
  it("returns correct colors for each verdict", () => {
    expect(verdictColor("EFFECTIVE")).toBe("green");
    expect(verdictColor("MARGINAL")).toBe("yellow");
    expect(verdictColor("INEFFECTIVE")).toBe("orange");
    expect(verdictColor("EMERGING")).toBe("cyan");
    expect(verdictColor("DEGRADING")).toBe("red");
  });
});

describe("verdictExplanation", () => {
  const rubric = [
    { criterion: "Accuracy", score: 0.9 },
    { criterion: "Completeness", score: 0.8 },
    { criterion: "Clarity", score: 0.3 },
  ];

  it("explains PASS with score 0.7", () => {
    const result = verdictExplanation("PASS", 0.7, rubric);
    expect(result.explanation).toContain("PASS");
    expect(result.explanation).toContain("0.70");
    expect(result.explanation).toContain("Accuracy");
    expect(result.recommendations).toBeUndefined();
  });

  it("explains PASS with score 1.0", () => {
    const result = verdictExplanation("PASS", 1.0, rubric);
    expect(result.explanation).toContain("met expectations");
    expect(result.recommendations).toBeUndefined();
  });

  it("explains EFFECTIVE with score >= 0.7", () => {
    const result = verdictExplanation("EFFECTIVE", 0.85, rubric);
    expect(result.explanation).toContain("EFFECTIVE");
    expect(result.explanation).toContain("met expectations");
    expect(result.recommendations).toBeUndefined();
  });

  it("explains FAIL with score 0.39", () => {
    const result = verdictExplanation("FAIL", 0.39, rubric);
    expect(result.explanation).toContain("FAIL");
    expect(result.explanation).toContain("did not meet");
    expect(result.recommendations).toBeDefined();
    expect(result.recommendations!.length).toBeGreaterThan(0);
  });

  it("explains FAIL with score 0.0", () => {
    const result = verdictExplanation("FAIL", 0.0, [
      { criterion: "Accuracy", score: 0.1 },
    ]);
    expect(result.explanation).toContain("FAIL");
    expect(result.recommendations).toBeDefined();
    expect(result.recommendations!.some((r) => r.includes("Accuracy"))).toBe(true);
  });

  it("explains DEGRADING with score < 0.4", () => {
    const result = verdictExplanation("DEGRADING", 0.2, rubric);
    expect(result.explanation).toContain("DEGRADING");
    expect(result.recommendations).toBeDefined();
  });

  it("explains INEFFECTIVE with score 0.15", () => {
    const result = verdictExplanation("INEFFECTIVE", 0.15, rubric);
    expect(result.explanation).toContain("INEFFECTIVE");
    expect(result.explanation).toContain("significantly below");
    expect(result.recommendations).toBeDefined();
    expect(result.recommendations!.some((r) => r.includes("examples"))).toBe(true);
  });

  it("handles boundary score 0.4 without recommendations", () => {
    const result = verdictExplanation("MARGINAL", 0.4, rubric);
    expect(result.explanation).toContain("MARGINAL");
    expect(result.explanation).toContain("mixed results");
    expect(result.recommendations).toBeUndefined();
  });

  it("works without rubric data", () => {
    const result = verdictExplanation("PASS", 0.8);
    expect(result.explanation).toContain("PASS");
    expect(result.recommendations).toBeUndefined();
  });

  it("provides recommendations only for FAIL/INEFFECTIVE, not PASS", () => {
    const passResult = verdictExplanation("PASS", 0.9, rubric);
    expect(passResult.recommendations).toBeUndefined();

    const failResult = verdictExplanation("FAIL", 0.2, rubric);
    expect(failResult.recommendations).toBeDefined();

    const ineffResult = verdictExplanation("INEFFECTIVE", 0.1, rubric);
    expect(ineffResult.recommendations).toBeDefined();
  });
});

describe("verdictLabel", () => {
  it('maps "EFFECTIVE" to "Strong Improvement"', () => {
    expect(verdictLabel("EFFECTIVE")).toBe("Strong Improvement");
  });

  it('maps "MARGINAL" to "Moderate Improvement"', () => {
    expect(verdictLabel("MARGINAL")).toBe("Moderate Improvement");
  });

  it('maps "EMERGING" to "Early Promise"', () => {
    expect(verdictLabel("EMERGING")).toBe("Early Promise");
  });

  it('maps "INEFFECTIVE" to "Needs Work"', () => {
    expect(verdictLabel("INEFFECTIVE")).toBe("Needs Work");
  });

  it('maps "DEGRADING" to "Regression"', () => {
    expect(verdictLabel("DEGRADING")).toBe("Regression");
  });

  it("passes through unknown verdict strings unchanged", () => {
    expect(verdictLabel("UNKNOWN_CODE")).toBe("UNKNOWN_CODE");
    expect(verdictLabel("")).toBe("");
    expect(verdictLabel("some-other-thing")).toBe("some-other-thing");
  });

  it("is a pure function with no side effects", () => {
    const result1 = verdictLabel("EFFECTIVE");
    const result2 = verdictLabel("EFFECTIVE");
    expect(result1).toBe(result2);
    expect(typeof verdictLabel).toBe("function");
  });
});
