import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockExistsSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.fn();

vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) =>
    mockDetectInstalledAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock lockfile
// ---------------------------------------------------------------------------
const mockReadLockfile = vi.fn();
const mockRemoveSkillFromLock = vi.fn();

vi.mock("../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  removeSkillFromLock: (...args: unknown[]) =>
    mockRemoveSkillFromLock(...args),
}));

// ---------------------------------------------------------------------------
// Mock paths
// ---------------------------------------------------------------------------
vi.mock("../utils/paths.js", () => ({
  resolveTilde: (p: string) =>
    p.startsWith("~/") ? `/home/testuser${p.slice(1)}` : p,
}));

// Import after mocks
const { removeCommand } = await import("./remove.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MOCK_AGENTS = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/commands",
    globalSkillsDir: "~/.claude/commands",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    localSkillsDir: ".cursor/skills",
    globalSkillsDir: "~/.cursor/skills",
  },
];

function makeLockfile(skills: Record<string, unknown> = {}) {
  return {
    version: 1,
    agents: ["claude-code", "cursor"],
    skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
});

describe("removeCommand", () => {
  it("removes skill from all detected agent directories", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "SCANNED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:/path",
        },
      }),
    );
    // All dirs exist
    mockExistsSync.mockReturnValue(true);

    await removeCommand("sw", { force: true });

    // Should attempt to remove from both agents (local + global = 4 paths)
    expect(mockRmSync).toHaveBeenCalled();
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith("sw");
  });

  it("errors when skill not in lockfile and no --force", async () => {
    mockReadLockfile.mockReturnValue(makeLockfile({}));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    await removeCommand("unknown-skill", {});

    expect(consoleSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("proceeds with --force even when skill not in lockfile", async () => {
    mockReadLockfile.mockReturnValue(makeLockfile({}));
    mockExistsSync.mockReturnValue(false);

    // Should not throw or exit
    await removeCommand("unknown-skill", { force: true });

    // Still tries detection, just nothing to remove
    expect(mockDetectInstalledAgents).toHaveBeenCalled();
  });

  it("only removes global dirs when --global flag set", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "SCANNED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:/path",
        },
      }),
    );
    mockExistsSync.mockReturnValue(true);

    await removeCommand("sw", { force: true, global: true });

    // Should only remove from global dirs (tilde-resolved paths)
    const removedPaths = mockRmSync.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    for (const p of removedPaths) {
      expect(p).toMatch(/^\/home\/testuser/);
    }
  });

  it("only removes local dirs when --local flag set", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "SCANNED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:/path",
        },
      }),
    );
    mockExistsSync.mockReturnValue(true);

    await removeCommand("sw", { force: true, local: true });

    // Should only remove from local dirs (relative paths resolved with cwd)
    const removedPaths = mockRmSync.mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    for (const p of removedPaths) {
      expect(p).not.toMatch(/^\/home\/testuser/);
    }
  });

  it("handles missing directories gracefully", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "SCANNED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:/path",
        },
      }),
    );
    // No dirs exist
    mockExistsSync.mockReturnValue(false);

    // Should not throw
    await removeCommand("sw", { force: true });

    // rmSync should not be called since dirs don't exist
    expect(mockRmSync).not.toHaveBeenCalled();
    // But lockfile should still be updated
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith("sw");
  });
});
