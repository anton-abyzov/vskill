// ---------------------------------------------------------------------------
// Tests for vskill versions command (T-011 / AC-US4-03, AC-US4-04)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetVersions = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  getVersions: mockGetVersions,
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

    await versionsCommand("owner/repo/skill");

    expect(mockGetVersions).toHaveBeenCalledWith("owner/repo/skill");
  });

  it("displays version list with version, certTier, and date", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.2", certTier: "VERIFIED", createdAt: "2026-04-01T10:00:00Z" },
      { version: "1.0.1", certTier: "VERIFIED", createdAt: "2026-03-15T10:00:00Z" },
      { version: "1.0.0", certTier: "CERTIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);

    await versionsCommand("owner/repo/skill");

    const output = logs.join("\n");
    expect(output).toContain("1.0.2");
    expect(output).toContain("1.0.1");
    expect(output).toContain("1.0.0");
    expect(output).toContain("VERIFIED");
    expect(output).toContain("CERTIFIED");
  });

  it("handles no versions found gracefully", async () => {
    mockGetVersions.mockResolvedValue([]);

    await versionsCommand("owner/repo/skill");

    const output = logs.join("\n");
    expect(output).toContain("No versions found");
  });

  it("handles skill not found (404) with error message and non-zero exit", async () => {
    mockGetVersions.mockRejectedValue(
      new Error("API request failed: 404 Not Found"),
    );

    await expect(versionsCommand("owner/repo/missing")).rejects.toThrow("process.exit");
    const errOutput = errors.join("\n");
    expect(errOutput).toContain("not found");
    expect(exitCode).toBe(1);
  });

  it("displays correct header for the versions table", async () => {
    mockGetVersions.mockResolvedValue([
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01T10:00:00Z" },
    ]);

    await versionsCommand("owner/repo/skill");

    const output = logs.join("\n");
    expect(output).toContain("Version");
    expect(output).toContain("Tier");
    expect(output).toContain("Date");
  });
});
