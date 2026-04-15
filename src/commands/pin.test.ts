// ---------------------------------------------------------------------------
// Tests for vskill pin / unpin commands
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockReadLockfile = vi.hoisted(() => vi.fn());
const mockWriteLockfile = vi.hoisted(() => vi.fn());
const mockGetVersions = vi.hoisted(() => vi.fn());

vi.mock("../lockfile/lockfile.js", () => ({
  readLockfile: mockReadLockfile,
  writeLockfile: mockWriteLockfile,
}));

vi.mock("../api/client.js", () => ({
  getVersions: mockGetVersions,
}));

const logs: string[] = [];
const errors: string[] = [];
let exitCode: number | undefined;

import { pinCommand, unpinCommand } from "./pin.js";

describe("pinCommand", () => {
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

  it("pins a skill at its installed version", async () => {
    const lock = {
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
    };
    mockReadLockfile.mockReturnValue(lock);

    await pinCommand("architect");

    expect(mockWriteLockfile).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: expect.objectContaining({
          architect: expect.objectContaining({
            pinnedVersion: "1.0.0",
          }),
        }),
      }),
    );
    const output = logs.join("\n");
    expect(output).toContain("Pinned architect at 1.0.0");
  });

  it("pins a skill at a specific version after validation", async () => {
    const lock = {
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
    };
    mockReadLockfile.mockReturnValue(lock);
    mockGetVersions.mockResolvedValue([
      { version: "2.0.0", certTier: "CERTIFIED", createdAt: "2026-04-01" },
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01" },
    ]);

    await pinCommand("architect", "2.0.0");

    expect(mockWriteLockfile).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: expect.objectContaining({
          architect: expect.objectContaining({
            pinnedVersion: "2.0.0",
          }),
        }),
      }),
    );
    const output = logs.join("\n");
    expect(output).toContain("Pinned architect at 2.0.0");
  });

  it("errors when skill is not installed", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });

    await expect(pinCommand("nonexistent")).rejects.toThrow("process.exit");
    expect(exitCode).toBe(1);
    const errOutput = errors.join("\n");
    expect(errOutput).toContain("not installed");
  });

  it("errors when no lockfile exists", async () => {
    mockReadLockfile.mockReturnValue(null);

    await expect(pinCommand("architect")).rejects.toThrow("process.exit");
    expect(exitCode).toBe(1);
  });

  it("errors when specified version does not exist", async () => {
    const lock = {
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
    };
    mockReadLockfile.mockReturnValue(lock);
    mockGetVersions.mockResolvedValue([
      { version: "1.0.0", certTier: "VERIFIED", createdAt: "2026-03-01" },
    ]);

    await expect(pinCommand("architect", "9.9.9")).rejects.toThrow("process.exit");
    expect(exitCode).toBe(1);
    const errOutput = errors.join("\n");
    expect(errOutput).toContain("9.9.9");
  });
});

describe("unpinCommand", () => {
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

  it("removes pinnedVersion from lockfile entry", async () => {
    const lock = {
      version: 1,
      agents: [],
      skills: {
        architect: {
          version: "1.0.0",
          sha: "abc",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "github:anthropics/skills",
          pinnedVersion: "1.0.0",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    mockReadLockfile.mockReturnValue(lock);

    await unpinCommand("architect");

    expect(mockWriteLockfile).toHaveBeenCalled();
    const writtenLock = mockWriteLockfile.mock.calls[0][0];
    expect(writtenLock.skills.architect.pinnedVersion).toBeUndefined();
    const output = logs.join("\n");
    expect(output).toContain("Unpinned architect");
  });

  it("errors when skill is not installed", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {},
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });

    await expect(unpinCommand("nonexistent")).rejects.toThrow("process.exit");
    expect(exitCode).toBe(1);
  });
});
