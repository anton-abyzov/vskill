import { describe, it, expect } from "vitest";
import { computeVerdict, verdictColor } from "../verdict.js";

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

  it("returns DEGRADING when passRate < 0.4", () => {
    expect(computeVerdict(0.30, 2.0, 3.0)).toBe("DEGRADING");
    expect(computeVerdict(0.10, 1.0, 1.0)).toBe("DEGRADING");
    expect(computeVerdict(0.0, 0.0, 0.0)).toBe("DEGRADING");
    expect(computeVerdict(0.39, 5.0, 1.0)).toBe("DEGRADING");
  });

  it("handles boundary values correctly", () => {
    // Exactly 0.8 pass rate, exactly +1 rubric → EFFECTIVE
    expect(computeVerdict(0.8, 4.0, 2.9)).toBe("EFFECTIVE");
    // 0.8 pass rate but rubric diff exactly 1 → NOT EFFECTIVE (needs >1)
    expect(computeVerdict(0.8, 4.0, 3.0)).toBe("MARGINAL");
    // Exactly 0.6 pass rate, skill > baseline → MARGINAL
    expect(computeVerdict(0.6, 3.1, 3.0)).toBe("MARGINAL");
    // Exactly 0.6 pass rate, skill = baseline → INEFFECTIVE
    expect(computeVerdict(0.6, 3.0, 3.0)).toBe("INEFFECTIVE");
    // Exactly 0.4 pass rate → INEFFECTIVE
    expect(computeVerdict(0.4, 3.0, 3.0)).toBe("INEFFECTIVE");
  });
});

describe("verdictColor", () => {
  it("returns correct colors for each verdict", () => {
    expect(verdictColor("EFFECTIVE")).toBe("green");
    expect(verdictColor("MARGINAL")).toBe("yellow");
    expect(verdictColor("INEFFECTIVE")).toBe("orange");
    expect(verdictColor("DEGRADING")).toBe("red");
  });
});
