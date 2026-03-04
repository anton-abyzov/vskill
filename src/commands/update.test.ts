import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// ---------------------------------------------------------------------------
// Mock lockfile
// ---------------------------------------------------------------------------
const mockReadLockfile = vi.fn();
const mockWriteLockfile = vi.fn();
vi.mock("../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

// ---------------------------------------------------------------------------
// Mock API client
// ---------------------------------------------------------------------------
const mockGetSkill = vi.fn();
vi.mock("../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.fn();
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock scanner
// ---------------------------------------------------------------------------
vi.mock("../scanner/index.js", () => ({
  runTier1Scan: () => ({ verdict: "PASS", score: 100, findings: [] }),
}));

// ---------------------------------------------------------------------------
// Mock output (suppress console noise)
// ---------------------------------------------------------------------------
vi.mock("../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  spinner: () => ({ stop: vi.fn() }),
}));

const MOCK_AGENTS = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/skills",
    globalSkillsDir: "~/.claude/skills",
    isUniversal: false,
    detectInstalled: "which claude",
    parentCompany: "Anthropic",
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    localSkillsDir: ".cursor/skills",
    globalSkillsDir: "~/.cursor/skills",
    isUniversal: true,
    detectInstalled: "which cursor",
    parentCompany: "Anysphere",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
  },
];

describe("updateCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code", "cursor"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "aaa111bbb222",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // Return updated content with different sha
    mockGetSkill.mockResolvedValue({
      content: "# Updated Skill",
      version: "2.0.0",
      sha: "new-sha-12345",
      tier: "VERIFIED",
    });
  });

  it("updates only the filtered agent when --agent is provided", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false, agent: "claude-code" });

    // Should only write to claude-code's skill dir, NOT cursor's
    const mkdirCalls = mockMkdirSync.mock.calls.map((c) => c[0] as string);
    const claudeCalls = mkdirCalls.filter((p: string) => p.includes(".claude"));
    const cursorCalls = mkdirCalls.filter((p: string) => p.includes(".cursor"));

    expect(claudeCalls.length).toBeGreaterThan(0);
    expect(cursorCalls.length).toBe(0);
  });

  it("updates all detected agents when --agent is NOT provided", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // Should write to BOTH agent dirs
    const mkdirCalls = mockMkdirSync.mock.calls.map((c) => c[0] as string);
    const claudeCalls = mkdirCalls.filter((p: string) => p.includes(".claude"));
    const cursorCalls = mkdirCalls.filter((p: string) => p.includes(".cursor"));

    expect(claudeCalls.length).toBeGreaterThan(0);
    expect(cursorCalls.length).toBeGreaterThan(0);
  });

  it("exits with error when --agent specifies unknown ID", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { updateCommand } = await import("./update.js");
    await expect(
      updateCommand("frontend", { all: false, agent: "nonexistent" }),
    ).rejects.toThrow("process.exit");

    expect(mockExit).toHaveBeenCalledWith(1);
    mockExit.mockRestore();
  });
});
