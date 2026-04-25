// ---------------------------------------------------------------------------
// 0724 T-012: idempotency + rollback integration tests.
//
// Asserts:
//   - AC-US2-03: enable() on already-enabled is a no-op (no second subprocess)
//   - AC-US3-03: disable() on already-disabled is a no-op
//   - AC-US1-05: when claudePluginInstall throws, rollback is invoked
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClaudePluginInstall = vi.fn();
const mockClaudePluginUninstall = vi.fn();
vi.mock("../../utils/claude-plugin.js", () => ({
  claudePluginInstall: (...args: unknown[]) => mockClaudePluginInstall(...args),
  claudePluginUninstall: (...args: unknown[]) => mockClaudePluginUninstall(...args),
}));

const mockReadLockfile = vi.fn();
const mockRemoveSkillFromLock = vi.fn();
vi.mock("../../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  removeSkillFromLock: (...args: unknown[]) => mockRemoveSkillFromLock(...args),
}));

let isEnabledState = false;
const mockIsPluginEnabled = vi.fn(() => isEnabledState);
vi.mock("../../settings/index.js", () => ({
  isPluginEnabled: (...args: unknown[]) => mockIsPluginEnabled(...args),
}));

vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: vi.fn(async () => [
    {
      id: "claude-code",
      displayName: "Claude Code",
      localSkillsDir: ".claude/skills",
      globalSkillsDir: "~/.claude/skills",
      isUniversal: false,
      detectInstalled: () => Promise.resolve(true),
      parentCompany: "Anthropic",
      featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    },
  ]),
  AGENTS_REGISTRY: [],
}));

vi.mock("../../utils/resolve-binary.js", () => ({
  resolveCliBinary: vi.fn(() => "/usr/local/bin/claude"),
}));

const mockExistsSync = vi.fn(() => true);
const mockRmSync = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  };
});

const { enableCommand } = await import("../enable.js");
const { disableCommand } = await import("../disable.js");
const { enableAfterInstall, rollbackInstall } = await import("../add.js");

const FOO = {
  version: "1.0.0",
  sha: "abc",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source: "marketplace:o/r#foo",
  marketplace: "m",
  pluginDir: true,
};

function lockOf(skills: Record<string, unknown>) {
  return {
    version: 1,
    agents: [],
    skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isEnabledState = false;
  mockReadLockfile.mockReturnValue(lockOf({ foo: FOO }));
  mockExistsSync.mockReturnValue(true);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---- AC-US2-03 -----------------------------------------------------------

describe("idempotency + rollback (T-012)", () => {
  it("AC-US2-03: second enable on already-enabled is a no-op", async () => {
    // First call flips state.
    mockIsPluginEnabled.mockImplementation(() => isEnabledState);
    mockClaudePluginInstall.mockImplementation(() => {
      isEnabledState = true;
    });

    await enableCommand("foo", { scope: "user" });
    expect(mockClaudePluginInstall).toHaveBeenCalledTimes(1);

    // Second call sees `isEnabledState === true` and bails before subprocess.
    await enableCommand("foo", { scope: "user" });
    expect(mockClaudePluginInstall).toHaveBeenCalledTimes(1);
  });

  // ---- AC-US3-03 ---------------------------------------------------------
  it("AC-US3-03: second disable on already-disabled is a no-op", async () => {
    isEnabledState = true;
    mockClaudePluginUninstall.mockImplementation(() => {
      isEnabledState = false;
    });

    await disableCommand("foo", { scope: "user" });
    expect(mockClaudePluginUninstall).toHaveBeenCalledTimes(1);

    await disableCommand("foo", { scope: "user" });
    expect(mockClaudePluginUninstall).toHaveBeenCalledTimes(1);
  });

  // ---- AC-US1-05 ---------------------------------------------------------
  it("AC-US1-05: claudePluginInstall throw -> caller can roll back files + lockfile", () => {
    mockClaudePluginInstall.mockImplementation(() => {
      throw new Error("claude exit 1");
    });

    expect(() =>
      enableAfterInstall("foo", { marketplace: "m" }, { enable: true }),
    ).toThrow(/claude exit 1/);

    // The caller (in add.ts) is expected to invoke rollbackInstall after a
    // throw. Verify it does its job: removes skill dir + lockfile entry.
    const agent = {
      id: "claude-code",
      displayName: "Claude Code",
      localSkillsDir: ".claude/skills",
      globalSkillsDir: "~/.claude/skills",
      isUniversal: false,
      detectInstalled: () => Promise.resolve(true),
      parentCompany: "Anthropic",
      featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    } as const;

    rollbackInstall("foo", [agent], {});

    expect(mockRmSync).toHaveBeenCalled();
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith("foo");
  });
});
