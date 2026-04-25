// ---------------------------------------------------------------------------
// Tests for src/commands/enable.ts (0724 T-003).
//
// `vskill enable <name>` reads vskill.lock, derives <name>@<marketplace>,
// calls claudePluginInstall, emits per-agent report. Idempotent.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- mocks ---------------------------------------------------------------

const mockClaudePluginInstall = vi.fn();

vi.mock("../../utils/claude-plugin.js", () => ({
  claudePluginInstall: (...args: unknown[]) => mockClaudePluginInstall(...args),
}));

const mockReadLockfile = vi.fn();

vi.mock("../../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
}));

const mockIsPluginEnabled = vi.fn();

vi.mock("../../settings/index.js", () => ({
  isPluginEnabled: (...args: unknown[]) => mockIsPluginEnabled(...args),
}));

const mockDetectInstalledAgents = vi.fn();

vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) =>
    mockDetectInstalledAgents(...args),
}));

const mockResolveCliBinary = vi.fn();

vi.mock("../../utils/resolve-binary.js", () => ({
  resolveCliBinary: (...args: unknown[]) => mockResolveCliBinary(...args),
}));

// import after mocks
const { enableCommand } = await import("../enable.js");

// ---- fixtures ------------------------------------------------------------

const CLAUDE_AGENT = {
  id: "claude-code",
  displayName: "Claude Code",
  localSkillsDir: ".claude/skills",
  globalSkillsDir: "~/.claude/skills",
  isUniversal: false,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "Anthropic",
  featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
};

const CURSOR_AGENT = {
  id: "cursor",
  displayName: "Cursor",
  localSkillsDir: ".cursor/skills",
  globalSkillsDir: "~/.cursor/skills",
  isUniversal: true,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "Anysphere",
  featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
};

function lockWith(skills: Record<string, unknown>) {
  return {
    version: 1,
    agents: ["claude-code"],
    skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const FOO_ENTRY = {
  version: "1.0.0",
  sha: "abc",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source: "marketplace:o/r#foo",
  marketplace: "m",
  pluginDir: true,
};

// ---- helpers -------------------------------------------------------------

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveCliBinary.mockReturnValue("/usr/local/bin/claude");
  mockDetectInstalledAgents.mockResolvedValue([CLAUDE_AGENT]);
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---- AC-US2-01 -----------------------------------------------------------

describe("enableCommand", () => {
  it("AC-US2-01: calls claudePluginInstall and exits 0 when foo is in lock and not yet enabled", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);

    await enableCommand("foo", { scope: "user" });

    expect(mockClaudePluginInstall).toHaveBeenCalledTimes(1);
    expect(mockClaudePluginInstall).toHaveBeenCalledWith("foo@m", "user", undefined);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ---- AC-US2-02 ---------------------------------------------------------
  it("AC-US2-02: exits 1 with a hint when foo is not in the lockfile", async () => {
    mockReadLockfile.mockReturnValue(lockWith({}));

    await enableCommand("foo", { scope: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const errOut = errSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(errOut).toMatch(/vskill install foo/);
  });

  it("AC-US2-02: exits 1 when lockfile itself is missing", async () => {
    mockReadLockfile.mockReturnValue(null);

    await enableCommand("foo", { scope: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
  });

  // ---- AC-US2-03: idempotent --------------------------------------------
  it("AC-US2-03: idempotent — already enabled, no subprocess, exit 0", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(true);

    await enableCommand("foo", { scope: "user" });

    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/already enabled in user scope/);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ---- AC-US2-04: scope routing -----------------------------------------
  it("AC-US2-04: --scope project routes to project scope and passes cwd", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);

    await enableCommand("foo", { scope: "project" });

    expect(mockClaudePluginInstall).toHaveBeenCalledWith(
      "foo@m",
      "project",
      expect.objectContaining({ cwd: expect.any(String) }),
    );
  });

  // ---- AC-US2-05: dry-run ------------------------------------------------
  it("AC-US2-05: --dry-run prints the would-be invocation, no subprocess", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);

    await enableCommand("foo", { scope: "user", dryRun: true });

    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/claude plugin install/);
    expect(out).toMatch(/foo@m/);
    expect(out).toMatch(/--scope user/);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ---- AC-US3-04 (mirror): auto-discovered no-op -------------------------
  it("auto-discovered skill (no marketplace) prints no-op message and skips subprocess", async () => {
    const autoEntry = { ...FOO_ENTRY, marketplace: undefined };
    mockReadLockfile.mockReturnValue(lockWith({ foo: autoEntry }));

    await enableCommand("foo", { scope: "user" });

    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/auto-discover/i);
  });

  // ---- AC-US5-04: --json -------------------------------------------------
  it("AC-US5-04: --json emits a parseable object with perAgent array", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);
    mockDetectInstalledAgents.mockResolvedValue([CLAUDE_AGENT, CURSOR_AGENT]);

    await enableCommand("foo", { scope: "user", json: true });

    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const printed = last.join(" ");
    const parsed = JSON.parse(printed);
    expect(parsed.skill).toBe("foo");
    expect(parsed.scope).toBe("user");
    expect(Array.isArray(parsed.perAgent)).toBe(true);
    expect(parsed.perAgent.length).toBeGreaterThanOrEqual(2);
    const ids = parsed.perAgent.map((p: { id: string }) => p.id);
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
  });

  // ---- AC-US5-03: only-cursor edge-case ---------------------------------
  it("AC-US5-03: when only non-claude agents detected, prints no-op message", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);
    mockDetectInstalledAgents.mockResolvedValue([CURSOR_AGENT]);

    await enableCommand("foo", { scope: "user" });

    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/auto-discover/i);
  });
});
