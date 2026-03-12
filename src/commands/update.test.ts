import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// ---------------------------------------------------------------------------
// Mock lockfile
// ---------------------------------------------------------------------------
const mockReadLockfile = vi.hoisted(() => vi.fn());
const mockWriteLockfile = vi.hoisted(() => vi.fn());
vi.mock("../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

// ---------------------------------------------------------------------------
// Mock API client (registry fallback)
// ---------------------------------------------------------------------------
const mockGetSkill = vi.hoisted(() => vi.fn());
vi.mock("../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

// ---------------------------------------------------------------------------
// Mock source-aware fetcher
// ---------------------------------------------------------------------------
const mockFetchFromSource = vi.hoisted(() => vi.fn());
vi.mock("../updater/source-fetcher.js", () => ({
  fetchFromSource: (...args: unknown[]) => mockFetchFromSource(...args),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.hoisted(() => vi.fn());
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock scanner
// ---------------------------------------------------------------------------
const mockRunTier1Scan = vi.hoisted(() =>
  vi.fn().mockReturnValue({ verdict: "PASS", score: 100, findings: [] }),
);
vi.mock("../scanner/index.js", () => ({
  runTier1Scan: (...args: unknown[]) => mockRunTier1Scan(...args),
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

const UPDATED_CONTENT = "# Updated Skill";
const UPDATED_FETCH_RESULT = {
  content: UPDATED_CONTENT,
  version: "2.0.0",
  sha: "new-sha-12345",
  tier: "VERIFIED",
};

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
    // Source-aware fetcher returns updated result by default
    mockFetchFromSource.mockResolvedValue(UPDATED_FETCH_RESULT);
    // Registry fallback (used when fetchFromSource returns null)
    mockGetSkill.mockResolvedValue({
      content: UPDATED_CONTENT,
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

  // ---------------------------------------------------------------------------
  // Source-aware routing tests
  // ---------------------------------------------------------------------------

  it("uses fetchFromSource instead of getSkill for non-registry sources", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockFetchFromSource).toHaveBeenCalled();
    // getSkill should NOT be called because fetchFromSource returned a result
    expect(mockGetSkill).not.toHaveBeenCalled();
  });

  it("falls back to getSkill when fetchFromSource returns null for unknown source", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "aaa111bbb222",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "",  // empty → unknown type → fallback to registry
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue(null);

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockGetSkill).toHaveBeenCalledWith("frontend");
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("skips skill and does not call getSkill for local source when fetchFromSource returns null", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        sw: {
          version: "1.0.0",
          sha: "aaa111bbb222",
          tier: "COMMUNITY",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "local:specweave",
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue(null);

    const { updateCommand } = await import("./update.js");
    await updateCommand("sw", { all: false });

    // local sources: no registry fallback, no file writes
    expect(mockGetSkill).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("skips skill when SHA is unchanged", async () => {
    // fetchFromSource returns same SHA as lockfile
    mockFetchFromSource.mockResolvedValue({
      content: "# Same content",
      version: "1.0.0",
      sha: "aaa111bbb222",  // same as lockfile entry
      tier: "VERIFIED",
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockWriteLockfile).toHaveBeenCalledTimes(1);  // still writes lockfile
  });

  it("runs tier1 scan on fetched content and skips on FAIL verdict", async () => {
    mockRunTier1Scan.mockReturnValue({ verdict: "FAIL", score: 0, findings: ["malicious"] });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockRunTier1Scan).toHaveBeenCalledWith(UPDATED_CONTENT);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("preserves source field in lockfile after update", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { source: string }>;
    };
    expect(writtenLock.skills["frontend"].source).toBe("github:test/repo");
  });

  it("writes lockfile exactly once after the loop", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0", sha: "aaa111bbb222", tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z", source: "github:test/repo",
        },
        backend: {
          version: "1.0.0", sha: "bbb222ccc333", tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z", source: "registry:backend",
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { all: true });

    expect(mockWriteLockfile).toHaveBeenCalledTimes(1);
  });
});
