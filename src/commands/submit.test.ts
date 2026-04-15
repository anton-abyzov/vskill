import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock browser opener
// ---------------------------------------------------------------------------
const mockOpenBrowser = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/browser.js", () => ({
  openBrowser: (...args: unknown[]) => mockOpenBrowser(...args),
}));

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------
const mockSubmitSkill = vi.fn().mockResolvedValue({
  id: "sub_test-123",
  state: "RECEIVED",
});
vi.mock("../api/client.js", () => ({
  submitSkill: (...args: unknown[]) => mockSubmitSkill(...args),
  getSubmission: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock utils/output (suppress console output in tests)
// ---------------------------------------------------------------------------
vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { submitCommand } = await import("./submit.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitSkill.mockResolvedValue({ id: "sub_test-123", state: "RECEIVED" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("submitCommand — API mode (default)", () => {
  it("calls submitSkill API with correct params", async () => {
    await submitCommand("myorg/myskill", { skill: "my-awesome-skill" });

    expect(mockSubmitSkill).toHaveBeenCalledOnce();
    expect(mockSubmitSkill).toHaveBeenCalledWith({
      repoUrl: "https://github.com/myorg/myskill",
      skillName: "my-awesome-skill",
      skillPath: undefined,
      source: "cli-auto",
    });
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it("passes --path option as skillPath", async () => {
    await submitCommand("myorg/myskill", {
      skill: "brain",
      path: "plugins/personal/skills/brain/SKILL.md",
    });

    expect(mockSubmitSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skillPath: "plugins/personal/skills/brain/SKILL.md",
      })
    );
  });

  it("handles alreadyVerified response", async () => {
    mockSubmitSkill.mockResolvedValue({ id: "sub_1", alreadyVerified: true });
    const consoleSpy = vi.spyOn(console, "log");

    await submitCommand("myorg/myskill", {});

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Already verified");
  });

  it("handles duplicate response", async () => {
    mockSubmitSkill.mockResolvedValue({ duplicate: true, submissionId: "sub_old" });
    const consoleSpy = vi.spyOn(console, "log");

    await submitCommand("myorg/myskill", {});

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Duplicate");
  });

  it("handles blocked response", async () => {
    mockSubmitSkill.mockResolvedValue({ blocked: true });
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(submitCommand("myorg/myskill", {})).rejects.toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });

  it("accepts full GitHub URL", async () => {
    await submitCommand("https://github.com/myorg/myskill", {});

    expect(mockSubmitSkill).toHaveBeenCalledWith(
      expect.objectContaining({ repoUrl: "https://github.com/myorg/myskill" })
    );
  });
});

describe("submitCommand — browser mode (--browser)", () => {
  it("opens browser with correct URL when --browser flag set", async () => {
    await submitCommand("myorg/myskill", { browser: true });

    expect(mockOpenBrowser).toHaveBeenCalledOnce();
    const url = mockOpenBrowser.mock.calls[0][0] as string;
    expect(url).toBe("https://verified-skill.com/submit?repo=myorg%2Fmyskill");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
  });

  it("includes --skill in browser URL", async () => {
    await submitCommand("myorg/myskill", { browser: true, skill: "my-skill" });

    const url = mockOpenBrowser.mock.calls[0][0] as string;
    expect(url).toBe("https://verified-skill.com/submit?repo=myorg%2Fmyskill&skill=my-skill");
  });
});

describe("submitCommand — validation", () => {
  it("rejects invalid source format", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(submitCommand("invalid-source", {})).rejects.toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockSubmitSkill).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it("rejects missing source", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(submitCommand(undefined, {})).rejects.toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});
