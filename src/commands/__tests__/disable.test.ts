// ---------------------------------------------------------------------------
// Tests for src/commands/disable.ts (0724 T-004).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClaudePluginUninstall = vi.fn();

vi.mock("../../utils/claude-plugin.js", () => ({
  claudePluginUninstall: (...args: unknown[]) => mockClaudePluginUninstall(...args),
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

const { disableCommand } = await import("../disable.js");

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

describe("disableCommand", () => {
  // ---- AC-US3-01 ---------------------------------------------------------
  it("AC-US3-01: calls claudePluginUninstall when foo is enabled at user scope", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    // First call (target scope) returns true; "still enabled in other scope" check returns false
    mockIsPluginEnabled.mockImplementation(
      (id: string, opts: { scope: string }) => opts.scope === "user",
    );

    await disableCommand("foo", { scope: "user" });

    expect(mockClaudePluginUninstall).toHaveBeenCalledTimes(1);
    expect(mockClaudePluginUninstall).toHaveBeenCalledWith("foo@m", "user", undefined);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ---- AC-US3-02: lockfile entry survives -------------------------------
  it("AC-US3-02: never reads or writes the lockfile beyond the initial read", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(true);

    await disableCommand("foo", { scope: "user" });

    // Initial read; no removeSkillFromLock import path is used.
    expect(mockReadLockfile).toHaveBeenCalledTimes(1);
  });

  // ---- AC-US3-03: idempotent --------------------------------------------
  it("AC-US3-03: idempotent — already disabled (or never enabled), no subprocess, exit 0", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(false);

    await disableCommand("foo", { scope: "user" });

    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/already disabled in user scope/);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ---- AC-US3-04: auto-discovered skill --------------------------------
  it("AC-US3-04: auto-discovered skill (no marketplace) prints vskill remove hint, exit 0", async () => {
    const autoEntry = { ...FOO_ENTRY, marketplace: undefined };
    mockReadLockfile.mockReturnValue(lockWith({ foo: autoEntry }));

    await disableCommand("foo", { scope: "user" });

    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/auto-discover/i);
    expect(out).toMatch(/vskill remove foo/);
  });

  // ---- AC-US3-05: scope isolation ---------------------------------------
  it("AC-US3-05: --scope project disables only project; user scope hint when still enabled there", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    // user scope still true, project scope true (the one we're disabling).
    mockIsPluginEnabled.mockImplementation(
      (_id: string, opts: { scope: string }) =>
        opts.scope === "user" || opts.scope === "project",
    );

    await disableCommand("foo", { scope: "project" });

    expect(mockClaudePluginUninstall).toHaveBeenCalledWith(
      "foo@m",
      "project",
      expect.objectContaining({ cwd: expect.any(String) }),
    );
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/still enabled in user scope/);
  });

  // ---- AC-US6-01: dry-run -----------------------------------------------
  it("AC-US6-01: --dry-run prints uninstall invocation, no subprocess", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockReturnValue(true);

    await disableCommand("foo", { scope: "user", dryRun: true });

    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/claude plugin uninstall/);
    expect(out).toMatch(/foo@m/);
    expect(out).toMatch(/--scope user/);
  });

  // ---- not-in-lockfile error path ---------------------------------------
  it("exits 1 with hint when foo is not in the lockfile", async () => {
    mockReadLockfile.mockReturnValue(lockWith({}));

    await disableCommand("foo", { scope: "user" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
  });

  // ---- JSON output -------------------------------------------------------
  it("--json emits parseable object with action=disabled", async () => {
    mockReadLockfile.mockReturnValue(lockWith({ foo: FOO_ENTRY }));
    mockIsPluginEnabled.mockImplementation(
      (_id: string, opts: { scope: string }) => opts.scope === "user",
    );

    await disableCommand("foo", { scope: "user", json: true });

    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const parsed = JSON.parse(last.join(" "));
    expect(parsed.skill).toBe("foo");
    expect(parsed.scope).toBe("user");
    expect(parsed.status).toBe("disabled");
  });
});
