import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseModelSpec,
  computeStats,
  computeMedian,
  computeCI95,
  aggregateRuns,
  detectJudgeBias,
  computeCompositeScore,
  computeSkillQualityScore,
} from "../../eval-server/sweep-runner.js";
import type { ModelSpec } from "../../eval-server/sweep-runner.js";
import type { BenchmarkResult, BenchmarkCase } from "../benchmark.js";

// ---------------------------------------------------------------------------
// Tests: parseModelSpec
// ---------------------------------------------------------------------------

describe("parseModelSpec", () => {
  // TC-039: anthropic/model parsed
  it("parses 'anthropic/claude-sonnet-4' correctly", () => {
    const result = parseModelSpec("anthropic/claude-sonnet-4");
    expect(result).toEqual({ provider: "anthropic", model: "claude-sonnet-4" });
  });

  // TC-038: openrouter/org/model parsed correctly
  it("parses 'openrouter/meta-llama/llama-3.1-70b' with nested slashes", () => {
    const result = parseModelSpec("openrouter/meta-llama/llama-3.1-70b");
    expect(result).toEqual({ provider: "openrouter", model: "meta-llama/llama-3.1-70b" });
  });

  it("parses 'ollama/llama3.1:8b' correctly", () => {
    const result = parseModelSpec("ollama/llama3.1:8b");
    expect(result).toEqual({ provider: "ollama", model: "llama3.1:8b" });
  });

  it("parses CLI providers", () => {
    expect(parseModelSpec("claude-cli/sonnet")).toEqual({ provider: "claude-cli", model: "sonnet" });
    expect(parseModelSpec("codex-cli/o4-mini")).toEqual({ provider: "codex-cli", model: "o4-mini" });
    expect(parseModelSpec("gemini-cli/gemini-2.5-pro")).toEqual({ provider: "gemini-cli", model: "gemini-2.5-pro" });
  });

  // TC-040: Unknown provider throws
  it("throws for unknown provider", () => {
    expect(() => parseModelSpec("unknown/foo")).toThrow('Unknown provider "unknown"');
  });

  it("throws for spec without slash", () => {
    expect(() => parseModelSpec("noSlashHere")).toThrow("expected");
  });

  it("throws for spec with empty model", () => {
    expect(() => parseModelSpec("anthropic/")).toThrow("empty");
  });
});

// ---------------------------------------------------------------------------
// Tests: computeStats
// ---------------------------------------------------------------------------

describe("computeStats", () => {
  // TC-050: Mean computed correctly
  it("computes mean for [0.8, 0.9, 0.7]", () => {
    const stats = computeStats([0.8, 0.9, 0.7]);
    expect(stats.mean).toBeCloseTo(0.8, 5);
  });

  // TC-051: Sample stddev computed correctly (Bessel's correction: N-1)
  it("computes sample stddev for [0.8, 0.9, 0.7]", () => {
    const stats = computeStats([0.8, 0.9, 0.7]);
    // Sample stddev: sqrt(((0.0^2 + 0.1^2 + (-0.1)^2) / 2)) = sqrt(0.02/2) = 0.1
    expect(stats.stddev).toBeCloseTo(0.1, 3);
  });

  // TC-052: N=1 stddev is 0
  it("returns stddev 0 for single value", () => {
    const stats = computeStats([0.85]);
    expect(stats.mean).toBeCloseTo(0.85, 5);
    expect(stats.stddev).toBe(0);
  });

  it("returns mean 0 for empty array", () => {
    const stats = computeStats([]);
    expect(stats.mean).toBe(0);
    expect(stats.stddev).toBe(0);
  });

  it("handles identical values (stddev = 0)", () => {
    const stats = computeStats([0.5, 0.5, 0.5]);
    expect(stats.mean).toBeCloseTo(0.5, 5);
    expect(stats.stddev).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Tests: aggregateRuns
// ---------------------------------------------------------------------------

describe("aggregateRuns", () => {
  function makeResult(passRate: number, durationMs: number): BenchmarkResult {
    return {
      timestamp: new Date().toISOString(),
      model: "test-model",
      skill_name: "test-skill",
      cases: [
        {
          eval_id: 1,
          eval_name: "case-1",
          status: passRate >= 1 ? "pass" : "fail",
          error_message: null,
          pass_rate: passRate,
          durationMs,
          assertions: [
            { id: "a1", text: "assertion 1", pass: passRate >= 1, reasoning: "ok" },
          ],
        },
      ] as BenchmarkCase[],
      overall_pass_rate: passRate,
      totalDurationMs: durationMs,
      type: "benchmark",
      provider: "anthropic",
    };
  }

  // TC-035: Both models run and aggregate
  it("aggregates multiple run results", () => {
    const results = [makeResult(0.8, 1000), makeResult(0.9, 1200), makeResult(0.7, 800)];
    const agg = aggregateRuns(results, "anthropic", "claude-sonnet-4");

    expect(agg.provider).toBe("anthropic");
    expect(agg.model).toBe("claude-sonnet-4");
    expect(agg.passRate.mean).toBeCloseTo(0.8, 3);
    expect(agg.passRate.stddev).toBeCloseTo(0.1, 3);
    expect(agg.duration.mean).toBeCloseTo(1000, -1);
    expect(agg.caseResults).toHaveLength(3);
  });

  it("handles single run", () => {
    const results = [makeResult(0.95, 500)];
    const agg = aggregateRuns(results, "openrouter", "llama-70b");

    expect(agg.passRate.mean).toBeCloseTo(0.95, 3);
    expect(agg.passRate.stddev).toBe(0);
    expect(agg.duration.stddev).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeMedian
// ---------------------------------------------------------------------------

describe("computeMedian", () => {
  it("returns median of odd-length array", () => {
    expect(computeMedian([0.3, 0.5, 0.9])).toBe(0.5);
  });

  it("returns median of even-length array", () => {
    expect(computeMedian([0.4, 0.6])).toBe(0.5);
  });

  it("returns 0 for empty array", () => {
    expect(computeMedian([])).toBe(0);
  });

  it("returns single value for length-1 array", () => {
    expect(computeMedian([0.7])).toBe(0.7);
  });

  it("handles unsorted input", () => {
    expect(computeMedian([0.9, 0.1, 0.5])).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeCI95
// ---------------------------------------------------------------------------

describe("computeCI95", () => {
  it("returns undefined for single value", () => {
    expect(computeCI95([0.8])).toBeUndefined();
  });

  it("returns bounds for two values", () => {
    const ci = computeCI95([0.7, 0.9]);
    expect(ci).toBeDefined();
    expect(ci![0]).toBeLessThan(0.8);
    expect(ci![1]).toBeGreaterThan(0.8);
  });

  it("lower bound can go below 0 for small values", () => {
    const ci = computeCI95([0.01, 0.02, 0.01]);
    expect(ci).toBeDefined();
    // No clamping — CI is raw, consumer decides how to interpret
    expect(ci![0]).toBeLessThan(ci![1]);
  });

  it("upper bound can exceed 1 for values near 1", () => {
    const ci = computeCI95([0.98, 0.99, 1.0]);
    expect(ci).toBeDefined();
    expect(ci![0]).toBeLessThan(ci![1]);
  });

  it("returns narrower CI with more data", () => {
    const ci2 = computeCI95([0.7, 0.9]);
    const ci10 = computeCI95([0.75, 0.8, 0.78, 0.82, 0.79, 0.81, 0.77, 0.83, 0.76, 0.84]);
    expect(ci10).toBeDefined();
    expect(ci2).toBeDefined();
    const width2 = ci2![1] - ci2![0];
    const width10 = ci10![1] - ci10![0];
    expect(width10).toBeLessThan(width2);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeStats enhanced
// ---------------------------------------------------------------------------

describe("computeStats (enhanced)", () => {
  it("includes median in output", () => {
    const stats = computeStats([0.3, 0.5, 0.9]);
    expect(stats.median).toBe(0.5);
  });

  it("includes ci95 for N>=2", () => {
    const stats = computeStats([0.7, 0.9]);
    expect(stats.ci95).toBeDefined();
  });

  it("ci95 is undefined for N=1", () => {
    const stats = computeStats([0.8]);
    expect(stats.ci95).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: detectJudgeBias
// ---------------------------------------------------------------------------

describe("detectJudgeBias", () => {
  it("detects exact match (self-judging)", () => {
    const result = detectJudgeBias(
      "anthropic/claude-sonnet-4",
      ["anthropic/claude-sonnet-4", "openrouter/meta-llama/llama-3.1-70b"],
    );
    expect(result).toBeDefined();
    expect(result!.warning).toContain("identical");
    expect(result!.matchedModel).toBe("anthropic/claude-sonnet-4");
  });

  it("detects same-family match (anthropic models)", () => {
    const result = detectJudgeBias(
      "anthropic/claude-sonnet-4",
      ["anthropic/claude-opus-4", "openrouter/meta-llama/llama-3.1-70b"],
    );
    expect(result).toBeDefined();
    expect(result!.warning).toContain("family");
    expect(result!.matchedModel).toBe("anthropic/claude-opus-4");
  });

  it("returns undefined for different providers", () => {
    const result = detectJudgeBias(
      "anthropic/claude-sonnet-4",
      ["openrouter/meta-llama/llama-3.1-70b", "ollama/llama3.1:8b"],
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when no models match", () => {
    const result = detectJudgeBias(
      "openrouter/gpt-4o",
      ["anthropic/claude-sonnet-4"],
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty model list", () => {
    expect(detectJudgeBias("anthropic/claude-sonnet-4", [])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: computeCompositeScore
// ---------------------------------------------------------------------------

describe("computeCompositeScore", () => {
  it("returns higher score for higher pass rate", () => {
    const scoreA = computeCompositeScore({ mean: 0.9, stddev: 0.05 }, 3);
    const scoreB = computeCompositeScore({ mean: 0.7, stddev: 0.05 }, 3);
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it("returns higher score for more runs (higher confidence)", () => {
    const score5runs = computeCompositeScore({ mean: 0.8, stddev: 0.05 }, 5);
    const score1run = computeCompositeScore({ mean: 0.8, stddev: 0.05 }, 1);
    expect(score5runs).toBeGreaterThan(score1run);
  });

  it("returns higher score for lower stddev (more stable)", () => {
    const stableScore = computeCompositeScore({ mean: 0.8, stddev: 0.01 }, 3);
    const unstableScore = computeCompositeScore({ mean: 0.8, stddev: 0.2 }, 3);
    expect(stableScore).toBeGreaterThan(unstableScore);
  });

  it("confidence caps at 1.0 for runs >= 5", () => {
    const score5 = computeCompositeScore({ mean: 0.8, stddev: 0.05 }, 5);
    const score10 = computeCompositeScore({ mean: 0.8, stddev: 0.05 }, 10);
    expect(score5).toBe(score10);
  });
});

// ---------------------------------------------------------------------------
// Tests: computeSkillQualityScore
// ---------------------------------------------------------------------------

describe("computeSkillQualityScore", () => {
  it("rates >= 20% as excellent", () => {
    const result = computeSkillQualityScore([25, 30, 20]);
    expect(result.rating).toBe("excellent");
    expect(result.score).toBe(25);
  });

  it("rates 10-20% as good", () => {
    const result = computeSkillQualityScore([12, 15, 18]);
    expect(result.rating).toBe("good");
  });

  it("rates 5-10% as marginal", () => {
    const result = computeSkillQualityScore([5, 7, 9]);
    expect(result.rating).toBe("marginal");
  });

  it("rates 0-5% as minimal", () => {
    const result = computeSkillQualityScore([1, 2, 3]);
    expect(result.rating).toBe("minimal");
  });

  it("rates negative as harmful", () => {
    const result = computeSkillQualityScore([-5, -3, -1]);
    expect(result.rating).toBe("harmful");
    expect(result.score).toBe(-3);
  });

  it("returns minimal for empty array", () => {
    const result = computeSkillQualityScore([]);
    expect(result.rating).toBe("minimal");
    expect(result.score).toBe(0);
  });
});
