import { describe, it, expect, vi, beforeEach } from "vitest";
import os from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockReadFileSync = vi.hoisted(() => vi.fn().mockReturnValue(""));
const mockReaddirSync = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockRmdirSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  rmdirSync: (...args: unknown[]) => mockRmdirSync(...args),
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
// GitHub repo visibility (GET /repos/{owner}/{repo}) and local checkouts'
// `origin` remotes: public unless a test says otherwise.
// ---------------------------------------------------------------------------
const githubVisibility = vi.hoisted(() => new Map<string, "public" | "private" | "unreachable">());
const gitOrigins = vi.hoisted(() => new Map<string, string>());
vi.mock("../discovery/github-tree.js", async () => {
  const visibility = await import("../lib/repo-visibility.js");
  return {
    getDefaultBranch: async (owner: string, repo: string) => {
      const v = githubVisibility.get(`${owner}/${repo}`) ?? "public";
      if (v !== "unreachable") visibility.recordRepoVisibility(owner, repo, { visibility: v });
      return "main";
    },
  };
});
vi.mock("node:child_process", () => ({
  execFileSync: (_cmd: string, args: string[], opts: { cwd: string }) => {
    const origin = [...gitOrigins.entries()].find(([dir]) => opts.cwd.endsWith(dir))?.[1];
    if (!origin) throw new Error("fatal: not a git repository");
    // Each mapped dir is the root of its own checkout.
    if (args[0] === "rev-parse") return Buffer.from(`${opts.cwd}\n`);
    return Buffer.from(`${origin}\n`);
  },
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
  beforeEach(async () => {
    vi.clearAllMocks();
    githubVisibility.clear();
    gitOrigins.clear();
    (await import("../lib/repo-visibility.js"))._resetRepoVisibilityForTests();
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

  it("never falls back to the registry for a skill from a private repo", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        onboarding: {
          version: "1.0.0",
          sha: "aaa111bbb222",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "github:acme/private-skills",
          sourcePrivate: true,
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue(null);

    const { updateCommand } = await import("./update.js");
    await updateCommand("onboarding", { all: false });

    expect(mockGetSkill).not.toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
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
    // The plugin dir is a checkout of a public GitHub repo.
    gitOrigins.set("specweave", "https://github.com/anton-abyzov/specweave.git");

    const { updateCommand } = await import("./update.js");
    await updateCommand("sw", { all: false });

    // Local sources now fall back to registry when cache is unavailable
    expect(mockGetSkill).toHaveBeenCalledWith("sw");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("F4: registry fallback computes sha in string mode (install identity)", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        frontend: {
          version: "1.0.0",
          sha: "aaa111bbb222",
          tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z",
          source: "",  // unknown type → registry fallback path
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue(null);

    const { updateCommand } = await import("./update.js");
    await updateCommand("frontend", { all: false });

    // The mocked computeSha returns "a"x64 for string input and "b"x64 for
    // files-map input. Install writes the string-mode sha, so the fallback
    // must store the string-mode value or the next update phantom-fires.
    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { sha: string }>;
    };
    expect(writtenLock.skills["frontend"].sha).toBe("a".repeat(64));
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

  it("keeps a plugin skill's name equal to its folder when upstream namespaces it", async () => {
    mockRunTier1Scan.mockReturnValue({ verdict: "PASS", score: 100, findings: [] });
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: ["claude-code"],
      skills: {
        "apify-data-gathering": {
          version: "1.0.0", sha: "aaa111bbb222", tier: "VERIFIED",
          installedAt: "2026-01-01T00:00:00.000Z", source: "github:test/repo",
          sourcePluginName: "marketing",
        },
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mockFetchFromSource.mockResolvedValue({
      ...UPDATED_FETCH_RESULT,
      content: "---\nname: marketing/apify-data-gathering\ndescription: Gathers data.\n---\n\n# Body\n",
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand("apify-data-gathering", { all: false });

    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    expect(mockInstallSymlink.mock.calls[0][1]).toMatch(/^---\nname: apify-data-gathering\n/);
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
    // 0765 metadata-only bump: when SHA matches, source does a canonical
    // platform lookup via getSkill. Reject it here so this test stays
    // focused on the "SHA matches, no change" intent — without this, the
    // default beforeEach mockGetSkill returns version 2.0.0 and triggers
    // a metadata bump path that overwrites lockfile.version.
    mockGetSkill.mockRejectedValueOnce(new Error("not found"));

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
    // Source intentionally passes serverVersion: undefined for non-registry
    // sources (update.ts: `parsed.type === "registry" ? result.version : undefined`).
    // Lockfile source is "github:test/repo", so serverVersion is undefined here.
    expect(mockResolveVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        serverVersion: undefined,
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

  it("0894: keeps a full installed skill folder when the update fetched only SKILL.md", async () => {
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
          files: ["SKILL.md", "assets/fonts/Inter.woff2", "scripts/lib/a.mjs"],
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

    expect(mockUnlinkSync).not.toHaveBeenCalled();
    const writtenLock = mockWriteLockfile.mock.calls[0][0] as {
      skills: Record<string, { files?: string[] }>;
    };
    expect(writtenLock.skills["frontend"].files).toEqual([
      "SKILL.md", "assets/fonts/Inter.woff2", "scripts/lib/a.mjs",
    ]);
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

// ---------------------------------------------------------------------------
// User-level installs: --global and the outside-a-project default
// ---------------------------------------------------------------------------
const onDiskUnderHome = (p: unknown) =>
  typeof p === "string" && p.startsWith(os.homedir()) && p.endsWith("SKILL.md");

describe("updateCommand — user-level lock (~/.agents/vskill.lock)", () => {
  const globalDir = join(os.homedir(), ".agents");
  const lockWith = (names: string[]) => ({
    version: 1,
    agents: ["claude-code"],
    skills: Object.fromEntries(names.map((n) => [n, {
      version: "1.0.0",
      sha: `old-${n}`,
      tier: "VERIFIED",
      installedAt: "2026-01-01T00:00:00.000Z",
      source: "github:test/repo",
    }])),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  let logs: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    githubVisibility.clear();
    gitOrigins.clear();
    (await import("../lib/repo-visibility.js"))._resetRepoVisibilityForTests();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    mockFetchFromSource.mockResolvedValue(UPDATED_FETCH_RESULT);
    mockResolveVersion.mockReturnValue("2.0.0");
    mockExtractFrontmatterVersion.mockReturnValue(undefined);
    mockRunTier1Scan.mockReturnValue({ verdict: "PASS", score: 100, findings: [] });
    mockInstallSymlink.mockReturnValue([]);
    // Every user-level skill in these tests is installed (a SKILL.md under ~).
    mockExistsSync.mockImplementation(onDiskUnderHome);
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  it("--global reads and writes ~/.agents/vskill.lock and installs globally", async () => {
    const globalLock = lockWith(["html-report"]);
    mockReadLockfile.mockImplementation((dir?: string) =>
      dir === globalDir ? globalLock : dir === os.homedir() ? null : lockWith(["project-skill"]));

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    expect(mockInstallSymlink.mock.calls[0][0]).toBe("html-report");
    expect(mockInstallSymlink.mock.calls[0][3]).toMatchObject({ global: true });
    expect(mockWriteLockfile).toHaveBeenCalledTimes(1);
    expect(mockWriteLockfile.mock.calls[0][1]).toBe(globalDir);
    expect(mockWriteLockfile.mock.calls[0][0].skills["html-report"].sha).toBe("new-sha-12345");
    // Project-level SKILL.md naming enforcement never runs over user dirs.
    expect(mockEnsureSkillMdNaming).not.toHaveBeenCalled();
  });

  it("falls back to the user-level lock when there is no project lock", async () => {
    const globalLock = lockWith(["html-report"]);
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? globalLock : null));

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, {});

    expect(mockInstallSymlink.mock.calls[0][3]).toMatchObject({ global: true });
    expect(mockWriteLockfile.mock.calls[0][1]).toBe(globalDir);
    expect(logs.join("\n")).toContain("updating user-level skills from");
  });

  it("keeps the project lock as the default inside a project", async () => {
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? lockWith(["user-skill"]) : dir === os.homedir() ? null : lockWith(["project-skill"])));

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, {});

    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    expect(mockInstallSymlink.mock.calls[0][0]).toBe("project-skill");
    expect(mockInstallSymlink.mock.calls[0][3]).toMatchObject({ global: false });
    expect(mockWriteLockfile.mock.calls[0][1]).not.toBe(globalDir);
  });

  it("also updates entries only the legacy ~/vskill.lock records, writing each lock back to its own dir", async () => {
    const current = lockWith(["shared"]);
    const legacy = lockWith(["shared", "old-only"]);
    mockReadLockfile.mockImplementation((dir?: string) =>
      dir === globalDir ? current : dir === os.homedir() ? legacy : null);

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockInstallSymlink.mock.calls.map((c) => c[0]).sort()).toEqual(["old-only", "shared"]);
    expect(mockWriteLockfile.mock.calls.map((c) => c[1])).toEqual([globalDir, os.homedir()]);
    // The legacy copy of "shared" is left to the current lock.
    expect(legacy.skills.shared.sha).toBe("old-shared");
    expect(legacy.skills["old-only"].sha).toBe("new-sha-12345");
  });

  it("names the --global flag when a skill is not in the project lock", async () => {
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? lockWith(["user-skill"]) : dir === os.homedir() ? null : lockWith(["project-skill"])));
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const { updateCommand } = await import("./update.js");
    await expect(updateCommand("user-skill", {})).rejects.toThrow("process.exit");
    expect(errors.join("\n")).toContain("vskill update user-skill --global");
    exit.mockRestore();
  });

  it("keeps the old lock entry when writing the update fails", async () => {
    const globalLock = lockWith(["html-report"]);
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? globalLock : null));
    mockInstallSymlink.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockWriteLockfile.mock.calls[0][0].skills["html-report"].sha).toBe("old-html-report");
    expect(logs.join("\n")).toContain("could not write the update");
  });

  it("leaves an entry with nothing on disk alone instead of installing it again", async () => {
    const current = lockWith(["html-report"]);
    const legacy = lockWith(["removed-by-hand"]);
    mockReadLockfile.mockImplementation((dir?: string) =>
      dir === globalDir ? current : dir === os.homedir() ? legacy : null);
    mockExistsSync.mockImplementation((p: unknown) =>
      onDiskUnderHome(p) && !String(p).includes("removed-by-hand"));

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockInstallSymlink.mock.calls.map((c) => c[0])).toEqual(["html-report"]);
    expect(mockFetchFromSource).toHaveBeenCalledTimes(1);
    expect(legacy.skills["removed-by-hand"].sha).toBe("old-removed-by-hand");
    expect(logs.join("\n")).toContain(`removed-by-hand: in ${join(os.homedir(), "vskill.lock")} but not on disk`);
  });
});

describe("updateCommand — user-level plugin entries", () => {
  it("skips a user-level plugin entry instead of writing a folder named after the plugin", async () => {
    vi.clearAllMocks();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    const globalDir = join(os.homedir(), ".agents");
    const lock = {
      version: 1,
      agents: [],
      skills: {
        frontend: {
          version: "0.2.0", sha: "", tier: "VERIFIED", installedAt: "",
          source: "marketplace:anton-abyzov/vskill#frontend", marketplace: "vskill", pluginDir: true,
        },
      },
      createdAt: "",
      updatedAt: "",
    };
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? lock : null));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockFetchFromSource).not.toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("vskill install anton-abyzov/vskill/frontend --global");
  });

  const userLock = (entries: Record<string, Record<string, unknown>>) => ({
    version: 1,
    agents: [],
    skills: Object.fromEntries(Object.entries(entries).map(([n, e]) => [n, {
      version: "1.0.0", sha: "old", tier: "VERIFIED", installedAt: "", ...e,
    }])),
    createdAt: "",
    updatedAt: "",
  });

  it("skips user-level --plugin and --plugin-dir installs too (no pluginDir flag)", async () => {
    vi.clearAllMocks();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    mockFetchFromSource.mockResolvedValue(UPDATED_FETCH_RESULT);
    const globalDir = join(os.homedir(), ".agents");
    const lock = userLock({
      nanobanana: { source: "github:resciencelab/opc-skills#plugin:nanobanana", scope: "user" },
      mine: { source: "local:/Users/me/My Plugins/mine", scope: "user", files: ["SKILL.md"] },
    });
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir ? lock : null));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    expect(mockFetchFromSource).not.toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
    const out = logs.join("\n");
    expect(out).toContain("vskill install resciencelab/opc-skills --plugin nanobanana --global");
    expect(out).toContain("vskill install --plugin-dir '/Users/me/My Plugins/mine' --plugin mine --global");
    expect(mockWriteLockfile.mock.calls[0][0].skills.nanobanana.sha).toBe("old");
  });

  it("still updates a --plugin entry in a project lock (project behaviour unchanged)", async () => {
    vi.clearAllMocks();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    mockFetchFromSource.mockResolvedValue(UPDATED_FETCH_RESULT);
    mockResolveVersion.mockReturnValue("2.0.0");
    mockRunTier1Scan.mockReturnValue({ verdict: "PASS", score: 100, findings: [] });
    mockInstallSymlink.mockReturnValue([]);
    const globalDir = join(os.homedir(), ".agents");
    const lock = userLock({ frontend: { source: "github:test/repo#plugin:frontend" } });
    mockReadLockfile.mockImplementation((dir?: string) => (dir === globalDir || dir === os.homedir() ? null : lock));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, {});

    expect(mockFetchFromSource).toHaveBeenCalledTimes(1);
    expect(mockInstallSymlink.mock.calls[0][3]).toMatchObject({ global: false });
  });

  it("keeps lock entries another process wrote while the update ran", async () => {
    vi.clearAllMocks();
    mockDetectInstalledAgents.mockResolvedValue(MOCK_AGENTS);
    mockFetchFromSource.mockResolvedValue(UPDATED_FETCH_RESULT);
    mockResolveVersion.mockReturnValue("2.0.0");
    mockRunTier1Scan.mockReturnValue({ verdict: "PASS", score: 100, findings: [] });
    mockInstallSymlink.mockReturnValue([]);
    const globalDir = join(os.homedir(), ".agents");
    const atStart = userLock({ "html-report": { source: "github:test/repo" } });
    const onDiskLater = userLock({
      "html-report": { source: "github:test/repo" },
      "installed-meanwhile": { source: "github:o/r" },
    });
    mockExistsSync.mockImplementation(onDiskUnderHome);
    let reads = 0;
    mockReadLockfile.mockImplementation((dir?: string) =>
      dir === globalDir ? (reads++ === 0 ? atStart : onDiskLater) : null);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const { updateCommand } = await import("./update.js");
    await updateCommand(undefined, { global: true });

    const written = mockWriteLockfile.mock.calls[0][0];
    expect(mockWriteLockfile.mock.calls[0][1]).toBe(globalDir);
    expect(Object.keys(written.skills).sort()).toEqual(["html-report", "installed-meanwhile"]);
    expect(written.skills["html-report"].sha).toBe("new-sha-12345");
    expect(written.skills["installed-meanwhile"].sha).toBe("old");
  });
});

describe("userLevelPluginReinstallCommand", () => {
  const entry = (source: string, extra: Record<string, unknown> = {}) =>
    ({ version: "1.0.0", sha: "", tier: "VERIFIED", installedAt: "", source, ...extra });

  it("gives an install command that routes back to the same plugin install", async () => {
    const { userLevelPluginReinstallCommand } = await import("./update.js");
    expect(userLevelPluginReinstallCommand("frontend", entry("marketplace:o/r#frontend", { pluginDir: true })))
      .toBe("vskill install o/r/frontend --global");
    expect(userLevelPluginReinstallCommand("p", entry("github:o/r#plugin:p"))).toBe("vskill install o/r --plugin p --global");
    expect(userLevelPluginReinstallCommand("sw", entry("local:specweave"))).toBe("vskill install --plugin-dir <folder> --plugin sw --global");
  });

  it("returns null for single-skill entries", async () => {
    const { userLevelPluginReinstallCommand } = await import("./update.js");
    expect(userLevelPluginReinstallCommand("a", entry("github:o/r"))).toBeNull();
    expect(userLevelPluginReinstallCommand("a", entry("registry:a"))).toBeNull();
    expect(userLevelPluginReinstallCommand("a", entry(""))).toBeNull();
  });
});

describe("skillInstallDirs", () => {
  it("lists each agent's project dir plus the shared .agents/skills copy", async () => {
    const { skillInstallDirs } = await import("./update.js");
    expect(skillInstallDirs(MOCK_AGENTS, "/proj", "foo")).toEqual([
      join("/proj", ".claude/skills", "foo"),
      join("/proj", ".cursor/skills", "foo"),
      join("/proj", ".agents/skills", "foo"),
    ]);
  });

  it("lists each agent's global dir plus ~/.agents/skills for global scope", async () => {
    const { skillInstallDirs } = await import("./update.js");
    const home = os.homedir();
    expect(skillInstallDirs(MOCK_AGENTS, "/ignored", "foo", true)).toEqual([
      join(home, ".claude", "skills", "foo"),
      join(home, ".cursor", "skills", "foo"),
      join(home, ".agents", "skills", "foo"),
    ]);
  });
});
