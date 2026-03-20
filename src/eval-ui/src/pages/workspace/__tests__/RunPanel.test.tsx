/**
 * RunPanel helper function tests (pure unit tests — no DOM/jsdom required)
 *
 * These tests cover the pure helper functions extracted from RunPanel.tsx that
 * produce labels, provenance strings, and comparison detail display values.
 * The helpers are exported for testability; they are not part of the public API.
 */
import { describe, it, expect } from "vitest";
import {
  passRateLabel,
  formatProvenance,
  deltaStatement,
  formatComparisonScore,
  winnerLabel,
} from "../RunPanel.js";

// ---------------------------------------------------------------------------
// T-002: passRateLabel — dynamic pass rate label based on benchmark type
// ---------------------------------------------------------------------------
describe("passRateLabel", () => {
  it('returns "Skill Pass Rate" for type "comparison"', () => {
    expect(passRateLabel("comparison")).toBe("Skill Pass Rate");
  });

  it('returns "Baseline Pass Rate" for type "baseline"', () => {
    expect(passRateLabel("baseline")).toBe("Baseline Pass Rate");
  });

  it('returns "Skill Pass Rate" for type "benchmark"', () => {
    expect(passRateLabel("benchmark")).toBe("Skill Pass Rate");
  });

  it('returns "Skill Pass Rate" when type is undefined', () => {
    expect(passRateLabel(undefined)).toBe("Skill Pass Rate");
  });

  it('returns "Skill Pass Rate" for any other run type (defensive runtime check)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(passRateLabel("model-compare" as any)).toBe("Skill Pass Rate");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(passRateLabel("improve" as any)).toBe("Skill Pass Rate");
  });
});

// ---------------------------------------------------------------------------
// T-003: formatProvenance — model + timestamp provenance line
// ---------------------------------------------------------------------------
describe("formatProvenance", () => {
  it("formats model and timestamp separated by ·", () => {
    const result = formatProvenance("claude-sonnet-4-5", "2026-03-19T19:30:00.000Z");
    expect(result).toContain("claude-sonnet-4-5");
    expect(result).toContain("·");
    expect(result).toContain("Mar 19, 2026");
    // AC-US1-04 requires time component (e.g. "7:30 PM")
    expect(result).toMatch(/\d+:\d{2}/);
  });

  it("returns only model when timestamp is missing", () => {
    const result = formatProvenance("claude-sonnet-4-5", undefined);
    expect(result).toBe("claude-sonnet-4-5");
    expect(result).not.toContain("·");
  });

  it("returns only timestamp when model is missing", () => {
    const result = formatProvenance(undefined, "2026-03-19T19:30:00.000Z");
    expect(result).toContain("Mar 19, 2026");
    expect(result).not.toContain("·");
  });

  it("returns empty string when both model and timestamp are missing", () => {
    expect(formatProvenance(undefined, undefined)).toBe("");
    expect(formatProvenance("", "")).toBe("");
  });

  it("ignores invalid (non-date) timestamp strings", () => {
    const result = formatProvenance("claude-sonnet-4-5", "not-a-date");
    // invalid timestamp → treated as missing → only model shown, no separator
    expect(result).toBe("claude-sonnet-4-5");
    expect(result).not.toContain("Invalid Date");
  });
});

// ---------------------------------------------------------------------------
// T-004: deltaStatement — human-readable value statement from comparison delta
// ---------------------------------------------------------------------------
describe("deltaStatement", () => {
  it("says 'more assertions' when delta is positive", () => {
    // delta=0.6, 5 cases each with 1 assertion = 5 total; 0.6*5 = 3 more
    const result = deltaStatement(0.6, 5, 5);
    expect(result).toContain("3");
    expect(result).toContain("more");
    expect(result).toContain("5 test cases");
  });

  it("says 'fewer assertions' when delta is negative", () => {
    // delta=-0.4, 5 cases each with 2 assertions = 10 total; 0.4*10 = 4 fewer
    const result = deltaStatement(-0.4, 10, 5);
    expect(result).toContain("4");
    expect(result).toContain("fewer");
    expect(result).toContain("5 test cases");
  });

  it("says 'performs the same' when delta is zero", () => {
    const result = deltaStatement(0, 6, 4);
    expect(result).toContain("same");
    expect(result).toContain("4 test cases");
  });

  it("says 'performs the same' when near-zero delta rounds to 0 assertions", () => {
    // delta=0.001, totalAssertions=1 → Math.round(0.001) = 0 → treat as same
    const result = deltaStatement(0.001, 1, 5);
    expect(result).toContain("same");
    expect(result).not.toContain("0 more");
  });

  it("handles singular test case correctly", () => {
    const result = deltaStatement(1.0, 3, 1);
    expect(result).toContain("1 test case");
    expect(result).not.toContain("1 test cases");
  });
});

// ---------------------------------------------------------------------------
// T-007: formatComparisonScore — per-case score display (percentage format)
// ---------------------------------------------------------------------------
describe("formatComparisonScore", () => {
  it("formats rubric scores (1-5 scale) as percentages", () => {
    // 5/5 → 100%, 4/5 → 80%, 3/5 → 60%
    expect(formatComparisonScore(5, 5)).toEqual({ skill: 100, baseline: 100 });
    expect(formatComparisonScore(4, 3)).toEqual({ skill: 80, baseline: 60 });
    expect(formatComparisonScore(5, 2)).toEqual({ skill: 100, baseline: 40 });
  });

  it("rounds to nearest integer", () => {
    // 3/5 = 60%, 1/5 = 20%
    expect(formatComparisonScore(3, 1)).toEqual({ skill: 60, baseline: 20 });
  });

  it("clamps out-of-range scores to [0, 100]", () => {
    expect(formatComparisonScore(0, 0)).toEqual({ skill: 0, baseline: 0 });
    expect(formatComparisonScore(6, 10)).toEqual({ skill: 100, baseline: 100 });
  });

  it("clamps negative inputs to 0", () => {
    expect(formatComparisonScore(-1, -2)).toEqual({ skill: 0, baseline: 0 });
    expect(formatComparisonScore(-5, 3)).toEqual({ skill: 0, baseline: 60 });
  });

  it("returns 0 for NaN inputs instead of propagating NaN", () => {
    expect(formatComparisonScore(NaN, 3)).toEqual({ skill: 0, baseline: 60 });
    expect(formatComparisonScore(4, NaN)).toEqual({ skill: 80, baseline: 0 });
    expect(formatComparisonScore(NaN, NaN)).toEqual({ skill: 0, baseline: 0 });
  });

  it("returns 0 for Infinity inputs instead of clamping to 100", () => {
    expect(formatComparisonScore(Infinity, 3)).toEqual({ skill: 0, baseline: 60 });
    expect(formatComparisonScore(-Infinity, 3)).toEqual({ skill: 0, baseline: 60 });
  });
});

// ---------------------------------------------------------------------------
// T-007: winnerLabel — winner badge text and style indicator
// ---------------------------------------------------------------------------
describe("winnerLabel", () => {
  it('returns "Skill wins" for winner "skill"', () => {
    expect(winnerLabel("skill").text).toBe("Skill wins");
    expect(winnerLabel("skill").isSkill).toBe(true);
  });

  it('returns "Baseline wins" for winner "baseline"', () => {
    expect(winnerLabel("baseline").text).toBe("Baseline wins");
    expect(winnerLabel("baseline").isSkill).toBe(false);
  });

  it('returns "Tie" for winner "tie"', () => {
    expect(winnerLabel("tie").text).toBe("Tie");
    expect(winnerLabel("tie").isSkill).toBe(false);
  });

  it('falls back to "Tie" for unrecognized winner values (defensive runtime check)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(winnerLabel("" as any).text).toBe("Tie");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(winnerLabel("draw" as any).text).toBe("Tie");
  });
});
