// ---------------------------------------------------------------------------
// Tests for vskill versions command
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetVersions = vi.hoisted(() => vi.fn());
const mockGetVersionDiff = vi.hoisted(() => vi.fn());
const mockReadLockfile = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  getVersions: mockGetVersions,
  getVersionDiff: mockGetVersionDiff,
}));

vi.mock("../lockfile/lockfile.js", () => ({
  readLockfile: mockReadLockfile,
}));

const logs: string[] = [];
const errors: string[] = [];
let exitCode: number | undefined;

import { versionsCommand } from "./versions.js";

describe("versionsCommand", () => {
  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    exitCode = undefined;
    mockReadLockfile.mockReturnValue(null);
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: number | string | null | undefined) => {
      exitCode = typeof code === "number" ? code : 1;
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls getVersions with the skill name", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.2", certTier: "VERIFIED", createdAt: "2026-04-01T10:00:00Z" },
      { version: "1.0.1", certTier: "VERIFIED", createdAt: "2026-03-15T10:00:00Z" },
      { version: "1.0.0", certTier: "CERTIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);

    await versionsCommand("owner/repo/skill", {});

    expect(mockGetVersions).toHaveBeenCalledWith("owner/repo/skill");
  });

  it("displays version list with version, certTier, and date", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.2", certTier: "VERIFIED", createdAt: "2026-04-01T10:00:00Z" },
      { version: "1.0.1", certTier: "VERIFIED", createdAt: "2026-03-15T10:00:00Z" },
      { version: "1.0.0", certTier: "CERTIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);

    await versionsCommand("owner/repo/skill", {});

    const output = logs.join("\n");
    expect(output).toContain("1.0.2");
    expect(output).toContain("1.0.1");
    expect(output).toContain("1.0.0");
    expect(output).toContain("VERIFIED");
    expect(output).toContain("CERTIFIED");
  });

  it("handles no versions found gracefully", async () => {
    mockGetVersions.mockResolvedValue([]);

    await versionsCommand("owner/repo/skill", {});

    const output = logs.join("\n");
    expect(output).toContain("No versions found");
  });

  it("handles skill not found (404) with error message and non-zero exit", async () => {
    mockGetVersions.mockRejectedValue(
      new Error("API request failed: 404 Not Found"),
    );

    await expect(versionsCommand("owner/repo/missing", {})).rejects.toThrow("process.exit");
    const errOutput = errors.join("\n");
    expect(errOutput).toContain("not found");
    expect(exitCode).toBe(1);
  });

  it("displays correct header for the versions table", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);

    await versionsCommand("owner/repo/skill", {});

    const output = logs.join("\n");
    expect(output).toContain("Version");
    expect(output).toContain("Tier");
    expect(output).toContain("Date");
  });

  // T-003: Installed marker + diffSummary column
  it("shows installed marker for the matching version", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        architect: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "github:anthropics/skills",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    mockGetVersions.mockResolvedValue([
      { version: "2.0.0", certTier: "CERTIFIED", createdAt: "2026-04-01T10:00:00Z", diffSummary: "Major rewrite" },
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z", diffSummary: "Initial release" },
    ]);

    await versionsCommand("architect", {});

    const output = logs.join("\n");
    expect(output).toContain("Installed");
    // The installed row should have a marker
    const lines = output.split("\n");
    const installedLine = lines.find((l) => l.includes("1.0.0"));
    expect(installedLine).toContain("►");
  });

  it("shows diffSummary in Changes column truncated to 60 chars", async () => {
    const longSummary = "A".repeat(80);
    mockGetVersions.mockResolvedValue([
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z", diffSummary: longSummary },
    ]);

    await versionsCommand("owner/repo/skill", {});

    const output = logs.join("\n");
    expect(output).toContain("Changes");
    expect(output).toContain("A".repeat(60) + "…");
    expect(output).not.toContain("A".repeat(61) + "…");
  });

  it("shows short diffSummary without truncation", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z", diffSummary: "Bug fix" },
    ]);

    await versionsCommand("owner/repo/skill", {});

    const output = logs.join("\n");
    expect(output).toContain("Bug fix");
  });

  // T-004: --diff flag
  it("prints unified diff with --diff when skill is installed", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        architect: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "github:anthropics/skills",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    mockGetVersions.mockResolvedValue([
      { version: "2.0.0", certTier: "CERTIFIED", createdAt: "2026-04-01T10:00:00Z" },
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);
    mockGetVersionDiff.mockResolvedValue({
      from: "1.0.0",
      to: "2.0.0",
      diffSummary: "Major rewrite",
      contentDiff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1,3 +1,3 @@\n-old line\n+new line\n context",
    });

    await versionsCommand("architect", { diff: true });

    expect(mockGetVersionDiff).toHaveBeenCalledWith(
      expect.stringContaining("architect"),
      "1.0.0",
      "2.0.0",
    );
    const output = logs.join("\n");
    expect(output).toContain("Major rewrite");
    expect(output).toContain("old line");
    expect(output).toContain("new line");
  });

  it("uses --from/--to when provided with --diff", async () => {
    mockGetVersionDiff.mockResolvedValue({
      from: "1.0.0",
      to: "1.5.0",
      diffSummary: "Changes",
      contentDiff: "-removed\n+added",
    });

    await versionsCommand("owner/repo/skill", { diff: true, from: "1.0.0", to: "1.5.0" });

    expect(mockGetVersionDiff).toHaveBeenCalledWith("owner/repo/skill", "1.0.0", "1.5.0");
  });

  it("warns when --diff used on uninstalled skill without --from/--to", async () => {
    mockReadLockfile.mockReturnValue(null);

    await versionsCommand("owner/repo/skill", { diff: true });

    const output = logs.join("\n");
    expect(output).toContain("Skill not installed");
    expect(output).toContain("--from");
    expect(output).toContain("--to");
  });

  // T-005: --json flag
  it("outputs valid JSON with --json flag", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        architect: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "github:anthropics/skills",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    mockGetVersions.mockResolvedValue([
      { version: "2.0.0", certTier: "CERTIFIED", createdAt: "2026-04-01T10:00:00Z", diffSummary: "Rewrite" },
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z", diffSummary: "Initial" },
    ]);

    await versionsCommand("architect", { json: true });

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty("version");
    expect(parsed[0]).toHaveProperty("diffSummary");
    expect(parsed[0]).toHaveProperty("installed");
    // Only the installed version should have installed: true
    const installed = parsed.find((v: any) => v.version === "1.0.0");
    expect(installed.installed).toBe(true);
    const notInstalled = parsed.find((v: any) => v.version === "2.0.0");
    expect(notInstalled.installed).toBe(false);
  });
});
