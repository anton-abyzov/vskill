import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseModelSpec, computeStats, aggregateRuns } from "../../eval-server/sweep-runner.js";
import type { ModelSpec, SweepSSEEvent } from "../../eval-server/sweep-runner.js";
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

  // TC-051: Stddev computed correctly
  it("computes stddev for [0.8, 0.9, 0.7]", () => {
    const stats = computeStats([0.8, 0.9, 0.7]);
    expect(stats.stddev).toBeCloseTo(0.0816, 3);
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
    expect(agg.passRate.stddev).toBeCloseTo(0.0816, 3);
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
