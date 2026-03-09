import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runEvalCoverage } from "../coverage.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

function createSkill(
  plugin: string,
  skill: string,
  opts: {
    evals?: object;
    benchmark?: object;
  } = {},
): void {
  const skillDir = join(testDir, plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);

  if (opts.evals) {
    mkdirSync(join(skillDir, "evals"), { recursive: true });
    writeFileSync(
      join(skillDir, "evals", "evals.json"),
      JSON.stringify(opts.evals),
    );
  }

  if (opts.benchmark) {
    mkdirSync(join(skillDir, "evals"), { recursive: true });
    writeFileSync(
      join(skillDir, "evals", "benchmark.json"),
      JSON.stringify(opts.benchmark),
    );
  }
}

const VALID_EVALS = {
  skill_name: "test-skill",
  evals: [
    {
      id: 1,
      name: "Test",
      prompt: "Do something",
      expected_output: "Output",
      assertions: [{ id: "a1", text: "check", type: "boolean" }],
    },
  ],
};

const PASS_BENCHMARK = {
  timestamp: "2026-03-01T00:00:00Z",
  model: "claude-sonnet-4-6",
  skill_name: "test-skill",
  cases: [
    {
      eval_id: 1,
      eval_name: "Test",
      status: "pass",
      error_message: null,
      pass_rate: 1.0,
      assertions: [{ id: "a1", text: "check", pass: true, reasoning: "ok" }],
    },
  ],
};

const FAIL_BENCHMARK = {
  ...PASS_BENCHMARK,
  cases: [
    {
      ...PASS_BENCHMARK.cases[0],
      status: "fail",
      pass_rate: 0.5,
      assertions: [
        { id: "a1", text: "check", pass: false, reasoning: "nope" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvalCoverage", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `vskill-cov-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("shows MISSING status for skill without evals", async () => {
    createSkill("marketing", "no-evals");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalCoverage(testDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("MISSING");
  });

  it("shows PENDING status for skill with evals but no benchmark", async () => {
    createSkill("marketing", "has-evals", { evals: VALID_EVALS });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalCoverage(testDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("PENDING");
  });

  it("shows PASS status when all assertions pass", async () => {
    createSkill("marketing", "passing", {
      evals: VALID_EVALS,
      benchmark: PASS_BENCHMARK,
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalCoverage(testDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("PASS");
  });

  it("shows FAIL status when any assertion fails", async () => {
    createSkill("marketing", "failing", {
      evals: VALID_EVALS,
      benchmark: FAIL_BENCHMARK,
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalCoverage(testDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("FAIL");
  });

  it("table has all required columns", async () => {
    createSkill("marketing", "test-skill", { evals: VALID_EVALS });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalCoverage(testDir);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("PLUGIN");
    expect(output).toContain("SKILL");
    expect(output).toContain("CASES");
    expect(output).toContain("ASSERTIONS");
    expect(output).toContain("LAST RUN");
    expect(output).toContain("STATUS");
  });
});
