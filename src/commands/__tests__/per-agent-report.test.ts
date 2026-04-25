// ---------------------------------------------------------------------------
// 0724 T-011: per-agent reporter integration tests.
//
// Stresses AC-US5-01..04 by mocking detectInstalledAgents to return
// different agent compositions and asserting the per-agent report shape on
// `vskill enable foo`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClaudePluginInstall = vi.fn();
const mockClaudePluginUninstall = vi.fn();
vi.mock("../../utils/claude-plugin.js", () => ({
  claudePluginInstall: (...args: unknown[]) => mockClaudePluginInstall(...args),
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

vi.mock("../../utils/resolve-binary.js", () => ({
  resolveCliBinary: vi.fn(() => "/usr/local/bin/claude"),
}));

const { enableCommand } = await import("../enable.js");

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

const CLAUDE = {
  id: "claude-code",
  displayName: "Claude Code",
  localSkillsDir: ".claude/skills",
  globalSkillsDir: "~/.claude/skills",
  isUniversal: false,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "Anthropic",
  featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
};
const CURSOR = {
  id: "cursor",
  displayName: "Cursor",
  localSkillsDir: ".cursor/skills",
  globalSkillsDir: "~/.cursor/skills",
  isUniversal: true,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "Anysphere",
  featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
};
const CODEX = {
  id: "codex",
  displayName: "Codex CLI",
  localSkillsDir: ".codex/skills",
  globalSkillsDir: "~/.codex/skills",
  isUniversal: true,
  detectInstalled: () => Promise.resolve(true),
  parentCompany: "OpenAI",
  featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
};

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLockfile.mockReturnValue(lockOf({ foo: FOO }));
  mockIsPluginEnabled.mockReturnValue(false);
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

// ---- AC-US5-01 + AC-US5-02 ----------------------------------------------

describe("per-agent reporter (T-011)", () => {
  it("AC-US5-01/02: claude+cursor+codex detected -> 3 lines, claude=enabled, others=auto-discover", async () => {
    mockDetectInstalledAgents.mockResolvedValue([CLAUDE, CURSOR, CODEX]);

    await enableCommand("foo", { scope: "user" });

    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/Claude Code \(user\) — enabled via claude CLI/);
    expect(out).toMatch(/Cursor — auto-discovers/);
    expect(out).toMatch(/Codex CLI — auto-discovers/);
    expect(mockClaudePluginInstall).toHaveBeenCalledTimes(1);
  });

  // ---- AC-US5-03 ---------------------------------------------------------
  it("AC-US5-03: only cursor detected -> no subprocess + auto-discover hint", async () => {
    mockDetectInstalledAgents.mockResolvedValue([CURSOR]);

    await enableCommand("foo", { scope: "user" });

    expect(mockClaudePluginInstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/auto-discover/i);
    expect(out).toMatch(/Cursor/);
  });

  // ---- AC-US5-04 ---------------------------------------------------------
  it("AC-US5-04: --json emits perAgent array with id+displayName+action+surface", async () => {
    mockDetectInstalledAgents.mockResolvedValue([CLAUDE, CURSOR]);

    await enableCommand("foo", { scope: "user", json: true });

    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const parsed = JSON.parse(last.join(" "));
    expect(parsed.perAgent).toHaveLength(2);
    const claude = parsed.perAgent.find((p: { id: string }) => p.id === "claude-code");
    expect(claude).toMatchObject({
      id: "claude-code",
      displayName: "Claude Code",
      surface: "claude-code-style",
      action: "enabled",
    });
    expect(claude).not.toHaveProperty("line"); // line is human-only
    const cursor = parsed.perAgent.find((p: { id: string }) => p.id === "cursor");
    expect(cursor).toMatchObject({
      id: "cursor",
      surface: "auto-discover",
      action: "not-applicable",
    });
  });
});
