import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
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
const mockComputeSha = vi.hoisted(() => vi.fn((input: unknown) => {
  // Mimic 64-char hex digest
  if (typeof input === "string") return "a".repeat(64);
  return "b".repeat(64);
}));
vi.mock("../updater/source-fetcher.js", () => ({
  fetchFromSource: (...args: unknown[]) => mockFetchFromSource(...args),
  computeSha: (...args: unknown[]) => mockComputeSha(...args),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.hoisted(() => vi.fn());
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock installer modules
// ---------------------------------------------------------------------------
vi.mock("../installer/frontmatter.js", () => ({
  ensureFrontmatter: (content: string, name: string) => `---\nname: ${name}\n---\n${content}`,
  stripClaudeFields: (content: string, _name: string) => content.replace(/^user-invocable\s*:.*\n?/gm, ""),
}));
const mockEnsureSkillMdNaming = vi.hoisted(() => vi.fn());
vi.mock("../installer/migrate.js", () => ({
  ensureSkillMdNaming: (...args: unknown[]) => mockEnsureSkillMdNaming(...args),
}));

// ---------------------------------------------------------------------------
// Mock canonical installer
// ---------------------------------------------------------------------------
const mockInstallSymlink = vi.hoisted(() => vi.fn().mockReturnValue([]));
vi.mock("../installer/canonical.js", () => ({
  installSymlink: (...args: unknown[]) => mockInstallSymlink(...args),
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
// Mock version utilities
// ---------------------------------------------------------------------------
const mockResolveVersion = vi.hoisted(() => vi.fn().mockReturnValue("2.0.0"));
const mockExtractFrontmatterVersion = vi.hoisted(() => vi.fn().mockReturnValue(undefined));
vi.mock("../utils/version.js", () => ({
  resolveVersion: (...args: unknown[]) => mockResolveVersion(...args),
  extractFrontmatterVersion: (...args: unknown[]) => mockExtractFrontmatterVersion(...args),
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
    // Version resolution defaults
    mockResolveVersion.mockReturnValue("2.0.0");
    mockExtractFrontmatterVersion.mockReturnValue(undefined);
  });

  it("updates only the filtered agent when --agent is provided", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false, agent: "claude-code" });

    // installSymlink should receive only claude-code agent, not cursor
    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    const agents = mockInstallSymlink.mock.calls[0][2];
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("claude-code");
  });

  it("updates all detected agents when --agent is NOT provided", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // installSymlink should receive both agents
    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    const agents = mockInstallSymlink.mock.calls[0][2];
    const agentIds = agents.map((a: { id: string }) => a.id);
    expect(agentIds).toContain("claude-code");
    expect(agentIds).toContain("cursor");
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
    expect(mockInstallSymlink).toHaveBeenCalled();
  });

  it("falls back to registry for local source when fetchFromSource returns null (no cache)", async () => {
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
    // Registry fallback also returns nothing
    mockGetSkill.mockRejectedValue(new Error("not found"));

    const { updateCommand } = await import("./update.js");
    await updateCommand("sw", { all: false });

    // Local sources now fall back to registry when cache is unavailable
    expect(mockGetSkill).toHaveBeenCalledWith("sw");
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

  it("TC-201: installSymlink receives correct skill name and content", async () => {
    mockRunTier1Scan.mockReturnValue({ verdict: "PASS", score: 100, findings: [] });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // installSymlink is responsible for frontmatter + writing; verify it was called with correct args
    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    const call = mockInstallSymlink.mock.calls[0];
    expect(call[0]).toBe("frontend"); // skill name
    expect(call[1]).toBe(UPDATED_CONTENT); // content passed for frontmatter handling
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

  // ---------------------------------------------------------------------------
  // US-005: No-change detection (64-char SHA comparison)
  // ---------------------------------------------------------------------------

  it("does not write files when 64-char SHA matches", async () => {
    const sha64 = "a1b2c3d4e5f6".repeat(5) + "a1b2";  // 62 chars, pad to 64
    const fullSha = sha64 + "ff";  // exactly 64 chars
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: fullSha,
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Same content",
      version: "1.0.0",
      sha: fullSha,
      tier: "VERIFIED",
      files: { "SKILL.md": "# Same content" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("does not modify lockfile entry when SHA matches", async () => {
    const fullSha = "c".repeat(64);
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.5.0",
          sha: fullSha,
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Same",
      version: "1.5.0",
      sha: fullSha,
      tier: "VERIFIED",
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { version: string; sha: string; installedAt: string }>;
    };
    // Version, sha, and installedAt should remain unchanged
    expect(writtenLock.skills["frontend"].version).toBe("1.5.0");
    expect(writtenLock.skills["frontend"].sha).toBe(fullSha);
    expect(writtenLock.skills["frontend"].installedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  // ---------------------------------------------------------------------------
  // US-005: Version resolution on update
  // ---------------------------------------------------------------------------

  it("calls resolveVersion when SHA has changed", async () => {
    mockFetchFromSource.mockResolvedValue({
      content: "# Changed",
      version: "3.0.0",
      sha: "d".repeat(64),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Changed" },
    });
    mockResolveVersion.mockReturnValue("3.0.0");

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockResolveVersion).toHaveBeenCalled();
    expect(mockResolveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        serverVersion: "3.0.0",
        hashChanged: true,
        isFirstInstall: false,
      }),
    );
    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { version: string }>;
    };
    expect(writtenLock.skills["frontend"].version).toBe("3.0.0");
  });

  // ---------------------------------------------------------------------------
  // US-006: Ghost file cleanup
  // ---------------------------------------------------------------------------

  it("deletes ghost files that exist in old manifest but not new", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "old-sha-" + "0".repeat(56),
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md", "agents/a.md", "agents/b.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Updated",
      version: "2.0.0",
      sha: "new-sha-" + "1".repeat(56),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Updated", "agents/a.md": "# Agent A" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // agents/b.md should be deleted for each agent directory
    const unlinkCalls = mockUnlinkSync.mock.calls.map((c) => c[0] as string);
    const ghostDeletes = unlinkCalls.filter((p: string) => p.includes("agents/b.md"));
    expect(ghostDeletes.length).toBeGreaterThan(0);
  });

  it("updates lockfile files array to reflect new version's files", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "old-sha-" + "0".repeat(56),
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md", "agents/a.md", "agents/b.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Updated",
      version: "2.0.0",
      sha: "new-sha-" + "1".repeat(56),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Updated", "agents/a.md": "# Agent A" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { files?: string[] }>;
    };
    expect(writtenLock.skills["frontend"].files).toEqual(["SKILL.md", "agents/a.md"]);
  });

  it("does not delete files when pre-migration entry has no files field", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "old-sha-" + "0".repeat(56),
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          // no files field — pre-migration entry
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Updated",
      version: "2.0.0",
      sha: "new-sha-" + "1".repeat(56),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Updated" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // No ghost deletions when old entry has no files manifest
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    // But new files manifest should be stored
    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { files?: string[] }>;
    };
    expect(writtenLock.skills["frontend"].files).toEqual(["SKILL.md"]);
  });

  // ---------------------------------------------------------------------------
  // US-006: Multi-file write
  // ---------------------------------------------------------------------------

  it("writes all files from result.files map", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "old-" + "0".repeat(60),
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Main",
      version: "2.0.0",
      sha: "new-" + "1".repeat(60),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Main", "agents/helper.md": "# Helper" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // installSymlink should be called with agentFiles containing the non-SKILL.md file
    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    const call = mockInstallSymlink.mock.calls[0];
    expect(call[0]).toBe("frontend"); // skill name
    expect(call[1]).toBe("# Main"); // SKILL.md content
    expect(call[4]).toEqual({ "agents/helper.md": "# Helper" }); // agentFiles
  });

  // ---------------------------------------------------------------------------
  // Canonical installer routing (installSymlink)
  // ---------------------------------------------------------------------------

  it("calls installSymlink instead of writing files directly", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockInstallSymlink).toHaveBeenCalled();
  });

  it("passes skill content and filtered agents to installSymlink", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    const call = mockInstallSymlink.mock.calls[0];
    // arg 0: skill name
    expect(call[0]).toBe("frontend");
    // arg 1: content (the SKILL.md content from the fetch result)
    expect(call[1]).toBe(UPDATED_CONTENT);
    // arg 2: agents array — should be all detected agents
    expect(call[2]).toEqual(MOCK_AGENTS);
    // arg 3: install options with projectRoot and global=false
    expect(call[3]).toMatchObject({ global: false, projectRoot: expect.any(String) });
  });

  it("passes agentFiles from result.files to installSymlink", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "old-" + "0".repeat(60),
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:test/repo",
          files: ["SKILL.md"],
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      content: "# Main",
      version: "2.0.0",
      sha: "new-" + "1".repeat(60),
      tier: "VERIFIED",
      files: { "SKILL.md": "# Main", "agents/helper.md": "# Helper" },
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    const call = mockInstallSymlink.mock.calls[0];
    // arg 4: agentFiles — should contain non-SKILL.md files
    expect(call[4]).toEqual({ "agents/helper.md": "# Helper" });
  });

  it("only passes filtered agents to installSymlink when --agent is used", async () => {
    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false, agent: "claude-code" });

    const call = mockInstallSymlink.mock.calls[0];
    // Only claude-code should be passed, not cursor
    expect(call[2]).toHaveLength(1);
    expect(call[2][0].id).toBe("claude-code");
  });

  it("does not call installSymlink when SHA is unchanged", async () => {
    mockFetchFromSource.mockResolvedValue({
      content: "# Same content",
      version: "1.0.0",
      sha: "aaa111bbb222",
      tier: "VERIFIED",
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockInstallSymlink).not.toHaveBeenCalled();
  });

  it("does not call installSymlink when scan fails", async () => {
    mockRunTier1Scan.mockReturnValue({ verdict: "FAIL", score: 0, findings: ["malicious"] });

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    expect(mockInstallSymlink).not.toHaveBeenCalled();
  });
});
