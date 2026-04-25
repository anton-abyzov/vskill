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

// ---------------------------------------------------------------------------
// Mock settings / claude-plugin (F-002 multi-scope path)
// ---------------------------------------------------------------------------
const mockIsPluginEnabled = vi.fn();
const mockClaudePluginUninstall = vi.fn();

vi.mock("../settings/index.js", () => ({
  isPluginEnabled: (...args: unknown[]) => mockIsPluginEnabled(...args),
}));

vi.mock("../utils/claude-plugin.js", () => ({
  claudePluginUninstall: (...args: unknown[]) =>
    mockClaudePluginUninstall(...args),
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
  // Default: no plugin registered anywhere — auto-discovered fixtures
  // short-circuit the F-002 multi-scope path. Marketplace tests override.
  mockIsPluginEnabled.mockReturnValue(false);
});

describe("removeCommand", () => {
  it("removes skill from all detected agent directories", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "VERIFIED",
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
          tier: "VERIFIED",
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
          tier: "VERIFIED",
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
          tier: "VERIFIED",
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

  // 0724 F-002 regression — marketplace plugin path (multi-scope uninstall)
  // Reason this test exists: prior fixtures had no `marketplace` field, so
  // resolvePluginId() always returned null and the multi-scope block in
  // remove.ts was unexercised. That coverage gap let an unimported
  // `isPluginEnabled` symbol slip through (F-001). This test pins the
  // marketplace path and asserts the F-002 contract: only enabled scopes
  // are uninstalled, and the JSON envelope reports pluginId/pluginUninstallOk.
  it("0724 F-002: marketplace plugin enabled at user-only scope uninstalls user only", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        foo: {
          version: "1.0.0",
          sha: "abc123",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "marketplace:specweave",
          marketplace: "specweave",
          scope: "user",
        },
      }),
    );
    mockExistsSync.mockReturnValue(false);
    // Plugin registered at user scope only — F-002 should walk both scopes
    // but only invoke uninstall for the enabled one.
    mockIsPluginEnabled.mockImplementation(
      (_id: string, opts: { scope: string }) => opts.scope === "user",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await removeCommand("foo", { force: true, json: true });

    // Walked both scopes, called uninstall only for user
    expect(mockIsPluginEnabled).toHaveBeenCalledWith("foo@specweave", {
      scope: "user",
    });
    expect(mockIsPluginEnabled).toHaveBeenCalledWith(
      "foo@specweave",
      expect.objectContaining({ scope: "project" }),
    );
    expect(mockClaudePluginUninstall).toHaveBeenCalledTimes(1);
    expect(mockClaudePluginUninstall).toHaveBeenCalledWith(
      "foo@specweave",
      "user",
      undefined,
    );

    // JSON envelope reports the marketplace contract
    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const parsed = JSON.parse(last.join(" "));
    expect(parsed.pluginId).toBe("foo@specweave");
    expect(parsed.pluginUninstallOk).toBe(true);
    logSpy.mockRestore();
  });

  // 0724 T-007 ----------------------------------------------------------
  it("0724 T-007: emits structured per-agent JSON when --json passed", async () => {
    mockReadLockfile.mockReturnValue(
      makeLockfile({
        sw: {
          version: "1.0.0",
          sha: "abc123",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:/path",
        },
      }),
    );
    mockExistsSync.mockReturnValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await removeCommand("sw", { force: true, json: true });

    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const parsed = JSON.parse(last.join(" "));
    expect(parsed.skill).toBe("sw");
    expect(parsed).toHaveProperty("perAgent");
    expect(Array.isArray(parsed.perAgent)).toBe(true);
    expect(parsed.perAgent.length).toBeGreaterThanOrEqual(1);
    logSpy.mockRestore();
  });
});
