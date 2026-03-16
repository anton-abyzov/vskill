import { describe, it, expect } from "vitest";
import { computeVerdict, verdictColor, verdictExplanation } from "../verdict.js";

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

  it("returns INEFFECTIVE when passRate >= 0.4 (but not MARGINAL)", () => {
    expect(computeVerdict(0.50, 2.5, 3.0)).toBe("INEFFECTIVE");
    expect(computeVerdict(0.45, 3.0, 3.0)).toBe("INEFFECTIVE");
    expect(computeVerdict(0.40, 1.0, 5.0)).toBe("INEFFECTIVE");
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

  it("handles boundary at passRate = 0.4", () => {
    // Exactly 0.4 → INEFFECTIVE (not EMERGING or DEGRADING)
    expect(computeVerdict(0.4, 3.0, 3.0)).toBe("INEFFECTIVE");
    expect(computeVerdict(0.4, 5.0, 0.0)).toBe("INEFFECTIVE");
    expect(computeVerdict(0.4, 1.0, 5.0)).toBe("INEFFECTIVE");
  });

  it("handles boundary at passRate = 0.6", () => {
    // Exactly 0.6, skill > baseline → MARGINAL
    expect(computeVerdict(0.6, 3.1, 3.0)).toBe("MARGINAL");
    // Exactly 0.6, skill = baseline → INEFFECTIVE
    expect(computeVerdict(0.6, 3.0, 3.0)).toBe("INEFFECTIVE");
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
