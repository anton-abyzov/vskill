import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("node:fs", () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));

vi.mock("../../../eval/llm.js", () => ({
  createLlmClient: () => ({
    generate: mocks.generate,
    model: "test-model",
  }),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { runEvalRun } = await import("../run.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_EVALS = {
  skill_name: "test-skill",
  evals: [
    {
      id: 1,
      name: "Basic test",
      prompt: "Test prompt 1",
      expected_output: "Expected output 1",
      files: [],
      assertions: [
        { id: "a1", text: "Output mentions AI", type: "boolean" },
        { id: "a2", text: "Output is concise", type: "boolean" },
      ],
    },
    {
      id: 2,
      name: "Edge case test",
      prompt: "Test prompt 2",
      expected_output: "Expected output 2",
      files: [],
      assertions: [
        { id: "b1", text: "Output handles edge case", type: "boolean" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvalRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: evals.json and SKILL.md both exist
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockImplementation((path: string) => {
      if (typeof path === "string" && path.endsWith("SKILL.md")) {
        return "# Test Skill\nYou are a test skill.";
      }
      return JSON.stringify(VALID_EVALS);
    });
  });

  it("prints results table on success", async () => {
    // Mock LLM: first call returns output, subsequent calls judge assertions
    let callCount = 0;
    mocks.generate.mockImplementation(async () => {
      callCount++;
      // First call per case = generate output, remaining = judge assertions
      if (callCount === 1) return "AI is great";
      if (callCount <= 3) return JSON.stringify({ pass: true, reasoning: "ok" });
      if (callCount === 4) return "Edge case handled";
      return JSON.stringify({ pass: false, reasoning: "not quite" });
    });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalRun("/skills/test-skill");

    // Check table was printed
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("a1");
    expect(output).toContain("b1");
    consoleSpy.mockRestore();
  });

  it("writes benchmark.json after run", async () => {
    mocks.generate.mockImplementation(async (_sys: string, prompt: string) => {
      if (prompt.includes("Test prompt")) return "LLM output here";
      return JSON.stringify({ pass: true, reasoning: "ok" });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalRun("/skills/test-skill");

    expect(mocks.writeFileSync).toHaveBeenCalled();
    const writtenPath = mocks.writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain("benchmark.json");
    const writtenContent = JSON.parse(mocks.writeFileSync.mock.calls[0][1]);
    expect(writtenContent.skill_name).toBe("test-skill");
    expect(writtenContent.cases).toHaveLength(2);

    vi.restoreAllMocks();
  });

  it("marks error case on LLM failure and continues", async () => {
    let callCount = 0;
    mocks.generate.mockImplementation(async () => {
      callCount++;
      // First case: output generation fails
      if (callCount === 1) throw new Error("API timeout");
      // Second case: works fine
      if (callCount === 2) return "Edge case handled";
      return JSON.stringify({ pass: true, reasoning: "ok" });
    });
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runEvalRun("/skills/test-skill");

    const writtenContent = JSON.parse(mocks.writeFileSync.mock.calls[0][1]);
    expect(writtenContent.cases[0].status).toBe("error");
    expect(writtenContent.cases[0].error_message).toContain("API timeout");
    expect(writtenContent.cases[1].status).toBe("pass");

    vi.restoreAllMocks();
  });

  it("exits with error for missing evals.json", async () => {
    mocks.existsSync.mockReturnValue(false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await runEvalRun("/skills/test-skill");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No evals.json found"),
    );
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("exits with error for invalid evals.json", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("{ broken json");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as any);

    await runEvalRun("/skills/test-skill");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid evals.json"),
    );
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
