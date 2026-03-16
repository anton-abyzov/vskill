import { describe, it, expect } from "vitest";
import { computeAggregateStats, getWinner } from "../pages/ComparisonPage";
import type { AggregateStats } from "../pages/ComparisonPage";

function makeComparison(overrides: Partial<{
  eval_id: number;
  eval_name: string;
  prompt: string;
  skillOutput: string;
  baselineOutput: string;
  skillContentScore: number;
  skillStructureScore: number;
  baselineContentScore: number;
  baselineStructureScore: number;
  winner: "skill" | "baseline" | "tie";
}> = {}) {
  return {
    eval_id: 1,
    eval_name: "test",
    prompt: "test prompt",
    skillOutput: "output",
    baselineOutput: "output",
    skillContentScore: 3,
    skillStructureScore: 3,
    baselineContentScore: 3,
    baselineStructureScore: 3,
    winner: "tie" as const,
    ...overrides,
  };
}

describe("computeAggregateStats", () => {
  it("computes correct averages for a single comparison", () => {
    const comps = [makeComparison({
      skillContentScore: 4,
      skillStructureScore: 4,
      baselineContentScore: 2,
      baselineStructureScore: 2,
      winner: "skill",
    })];
    const result = computeAggregateStats(comps);
    expect(result.skill.avgScore).toBe(4);
    expect(result.baseline.avgScore).toBe(2);
    expect(result.skill.passRate).toBe(1);
    expect(result.baseline.passRate).toBe(0);
  });

  it("computes correct averages for multiple comparisons", () => {
    const comps = [
      makeComparison({ eval_id: 1, skillContentScore: 5, skillStructureScore: 3, baselineContentScore: 2, baselineStructureScore: 4, winner: "skill" }),
      makeComparison({ eval_id: 2, skillContentScore: 1, skillStructureScore: 1, baselineContentScore: 4, baselineStructureScore: 4, winner: "baseline" }),
    ];
    const result = computeAggregateStats(comps);
    expect(result.skill.avgScore).toBe((4 + 1) / 2); // (5+3)/2=4, (1+1)/2=1, avg=(4+1)/2=2.5
    expect(result.baseline.avgScore).toBe((3 + 4) / 2); // (2+4)/2=3, (4+4)/2=4, avg=(3+4)/2=3.5
    expect(result.skill.passRate).toBe(0.5);
    expect(result.baseline.passRate).toBe(0.5);
  });

  it("handles all ties", () => {
    const comps = [
      makeComparison({ eval_id: 1, winner: "tie" }),
      makeComparison({ eval_id: 2, winner: "tie" }),
    ];
    const result = computeAggregateStats(comps);
    expect(result.skill.passRate).toBe(0);
    expect(result.baseline.passRate).toBe(0);
  });
});

describe("getWinner", () => {
  it("returns skill when skill avgScore is higher", () => {
    const skill: AggregateStats = { passRate: 0.8, avgScore: 4.0, avgDurationMs: 0, caseCount: 3 };
    const baseline: AggregateStats = { passRate: 0.2, avgScore: 2.0, avgDurationMs: 0, caseCount: 3 };
    expect(getWinner(skill, baseline)).toBe("skill");
  });

  it("returns baseline when baseline avgScore is higher", () => {
    const skill: AggregateStats = { passRate: 0.2, avgScore: 2.0, avgDurationMs: 0, caseCount: 3 };
    const baseline: AggregateStats = { passRate: 0.8, avgScore: 4.0, avgDurationMs: 0, caseCount: 3 };
    expect(getWinner(skill, baseline)).toBe("baseline");
  });

  it("returns tie when scores are equal", () => {
    const skill: AggregateStats = { passRate: 0.5, avgScore: 3.0, avgDurationMs: 0, caseCount: 3 };
    const baseline: AggregateStats = { passRate: 0.5, avgScore: 3.0, avgDurationMs: 0, caseCount: 3 };
    expect(getWinner(skill, baseline)).toBe("tie");
  });

  it("returns tie when scores are within 0.01 threshold", () => {
    const skill: AggregateStats = { passRate: 0.5, avgScore: 3.005, avgDurationMs: 0, caseCount: 3 };
    const baseline: AggregateStats = { passRate: 0.5, avgScore: 3.0, avgDurationMs: 0, caseCount: 3 };
    expect(getWinner(skill, baseline)).toBe("tie");
  });
});
