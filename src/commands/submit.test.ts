import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock browser opener
// ---------------------------------------------------------------------------
const mockOpenBrowser = vi.fn().mockResolvedValue(undefined);
// These cases name public skills; visibility is covered in
// lib/__tests__/private-source-egress-1.2.1.test.ts.
const mockRepoStatus = vi.hoisted(() => ({ value: "public" as "public" | "private" | "not-found" | "unconfirmed" }));
vi.mock("../lib/private-source.js", () => ({
  isTypedRepoPrivate: vi.fn(async () => false),
  typedRepoStatus: vi.fn(async () => mockRepoStatus.value),
}));

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
  mockRepoStatus.value = "public";
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
      source: "cli-submit",
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

describe("submitCommand — 0932 messages (AC-11)", () => {
  const text = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("prints the full owner/repo/skill name for vskill info", async () => {
    const log = vi.spyOn(console, "log");
    await submitCommand("myorg/myrepo", { skill: "greet" });
    expect(text(log)).toContain("vskill info myorg/myrepo/greet");
  });

  it("reports a rejected submission as rejected, not as a duplicate, and exits 1", async () => {
    mockSubmitSkill.mockResolvedValue({ id: "sub_r", state: "REJECTED", duplicate: true });
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(submitCommand("myorg/myrepo", { skill: "greet" })).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    expect(text(err)).toContain("Rejected");
    expect(text(log)).not.toContain("Duplicate");
    exit.mockRestore();
  });

  it("says a 404 repo was not found instead of calling it private", async () => {
    mockRepoStatus.value = "not-found";
    const err = vi.spyOn(console, "error");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });
    await expect(submitCommand("myorg/nope", {})).rejects.toThrow("exit");
    expect(text(err)).toContain("myorg/nope was not found on GitHub");
    expect(text(err)).not.toContain("is a private repository");
    expect(mockSubmitSkill).not.toHaveBeenCalled();
    exit.mockRestore();
  });

  it("announces a requeued (changed) skill as a resubmission", async () => {
    mockSubmitSkill.mockResolvedValue({ id: "sub_q", state: "RECEIVED", requeued: true });
    const log = vi.spyOn(console, "log");
    await submitCommand("myorg/myrepo", { skill: "greet" });
    expect(text(log)).toContain("Resubmitted!");
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

  it.each([
    ["--submission", { submission: "psub_00000000-0000-0000-0000-000000000000", tenant: "x" }],
    ["--tenant", { tenant: "x" }],
  ])("prints a usage error and exits 1 for %s without --private", async (_flag, opts) => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    // The only rejection is the mocked exit: no usage Error escapes to Node.
    await expect(submitCommand("myorg/myskill", opts)).rejects.toThrow(/^exit$/);
    expect(console.error).toHaveBeenCalledWith("--tenant and --submission require --private for publishing.");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockSubmitSkill).not.toHaveBeenCalled();

    mockExit.mockRestore();
  });
});
