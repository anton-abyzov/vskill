import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeBenchmark, readBenchmark } from "../benchmark.js";
import type { BenchmarkResult } from "../benchmark.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

const SAMPLE_BENCHMARK: BenchmarkResult = {
  timestamp: "2026-03-01T00:00:00.000Z",
  model: "claude-sonnet-4-6",
  skill_name: "test-skill",
  cases: [
    {
      eval_id: 1,
      eval_name: "Basic test",
      status: "pass",
      error_message: null,
      pass_rate: 1.0,
      assertions: [
        {
          id: "a1",
          text: "Check result",
          pass: true,
          reasoning: "Looks good",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("benchmark", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-bench-${Date.now()}`);
    mkdirSync(join(testDir, "evals"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("writes benchmark.json with all required fields", async () => {
    await writeBenchmark(testDir, SAMPLE_BENCHMARK);

    const result = await readBenchmark(testDir);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe("2026-03-01T00:00:00.000Z");
    expect(result!.model).toBe("claude-sonnet-4-6");
    expect(result!.skill_name).toBe("test-skill");
    expect(result!.cases).toHaveLength(1);
    expect(result!.cases[0].assertions).toHaveLength(1);
  });

  it("reads benchmark.json and returns typed result", async () => {
    writeFileSync(
      join(testDir, "evals", "benchmark.json"),
      JSON.stringify(SAMPLE_BENCHMARK),
    );

    const result = await readBenchmark(testDir);
    expect(result!.skill_name).toBe("test-skill");
    expect(result!.cases[0].pass_rate).toBe(1.0);
  });

  it("returns null for missing benchmark.json", async () => {
    rmSync(join(testDir, "evals"), { recursive: true, force: true });

    const result = await readBenchmark(testDir);
    expect(result).toBeNull();
  });
});
