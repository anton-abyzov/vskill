import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  runEvalInit: vi.fn(),
  runEvalRun: vi.fn(),
  runEvalCoverage: vi.fn(),
  runEvalGenerateAll: vi.fn(),
}));

vi.mock("../eval/init.js", () => ({ runEvalInit: mocks.runEvalInit }));
vi.mock("../eval/run.js", () => ({ runEvalRun: mocks.runEvalRun }));
vi.mock("../eval/coverage.js", () => ({
  runEvalCoverage: mocks.runEvalCoverage,
}));
vi.mock("../eval/generate-all.js", () => ({
  runEvalGenerateAll: mocks.runEvalGenerateAll,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

const { evalCommand } = await import("../eval.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evalCommand router", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("routes init subcommand to runEvalInit", async () => {
    await evalCommand("init", "marketing/social-media-posting", {
      root: "/tmp/test",
    });

    expect(mocks.runEvalInit).toHaveBeenCalledWith(
      expect.stringContaining("marketing/skills/social-media-posting"),
      false,
    );
  });

  it("routes run subcommand to runEvalRun", async () => {
    await evalCommand("run", "marketing/social-media-posting", {
      root: "/tmp/test",
    });

    expect(mocks.runEvalRun).toHaveBeenCalledWith(
      expect.stringContaining("marketing/skills/social-media-posting"),
    );
  });

  it("routes coverage subcommand to runEvalCoverage", async () => {
    await evalCommand("coverage", undefined, { root: "/tmp/test" });

    expect(mocks.runEvalCoverage).toHaveBeenCalledWith("/tmp/test");
  });

  it("routes generate-all subcommand to runEvalGenerateAll", async () => {
    await evalCommand("generate-all", undefined, {
      root: "/tmp/test",
      force: true,
    });

    expect(mocks.runEvalGenerateAll).toHaveBeenCalledWith("/tmp/test", true);
  });

  it("prints error for unknown subcommand", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await evalCommand("unknown", undefined, { root: "/tmp/test" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown subcommand"),
    );
    consoleSpy.mockRestore();
  });
});
