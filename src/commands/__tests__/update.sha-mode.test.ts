import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// F4 integration: phantom 'update' + lockfile sha self-corruption on
// unchanged GitHub-installed skills.
//
// `vskill add` writes computeSha(content) — STRING mode — into the lockfile.
// The update path must compare and write the SAME identity, so this suite
// runs updateCommand against the REAL source-fetcher (real computeSha) with
// only network / fs / installer boundaries mocked.
// ---------------------------------------------------------------------------

const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    existsSync: () => false,
    readdirSync: () => [],
    rmdirSync: vi.fn(),
  };
});

const mockReadLockfile = vi.hoisted(() => vi.fn());
const mockWriteLockfile = vi.hoisted(() => vi.fn());
vi.mock("../../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

// Platform lookup on the unchanged path (0765) — reject so it stays inert.
const mockGetSkill = vi.hoisted(() => vi.fn());
vi.mock("../../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

const mockDetectInstalledAgents = vi.hoisted(() => vi.fn());
vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
}));

vi.mock("../../installer/migrate.js", () => ({
  ensureSkillMdNaming: vi.fn(),
}));

const mockInstallSymlink = vi.hoisted(() => vi.fn().mockReturnValue([]));
vi.mock("../../installer/canonical.js", () => ({
  installSymlink: (...args: unknown[]) => mockInstallSymlink(...args),
}));

vi.mock("../../scanner/index.js", () => ({
  runTier1Scan: () => ({ verdict: "PASS", score: 100, findings: [], criticalCount: 0, highCount: 0, mediumCount: 0 }),
}));

const mockGetDefaultBranch = vi.hoisted(() => vi.fn());
vi.mock("../../discovery/github-tree.js", () => ({
  getDefaultBranch: (...args: unknown[]) => mockGetDefaultBranch(...args),
}));

vi.mock("../../marketplace/index.js", () => ({
  getPluginSource: vi.fn(),
  getPluginVersion: vi.fn(),
}));

vi.mock("../../core-skills/sync.js", () => ({
  findCoreSkillsDir: vi.fn().mockReturnValue(null),
  listCoreSkills: vi.fn().mockReturnValue([]),
}));

vi.mock("../../utils/output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  spinner: () => ({ stop: vi.fn() }),
}));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

import { computeSha } from "../../updater/source-fetcher.js";

const AGENTS = [
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
];

const CONTENT = "---\nname: myskill\nversion: 1.0.0\n---\n# My Skill";
const NEW_CONTENT = "---\nname: myskill\nversion: 2.0.0\n---\n# My Skill v2";

function lockWithSha(sha: string) {
  return {
    version: 1,
    agents: ["claude-code"],
    skills: {
      myskill: {
        version: "1.0.0",
        sha,
        tier: "VERIFIED",
        installedAt: "2026-01-01T00:00:00.000Z",
        source: "github:foo/bar",
        files: ["SKILL.md"],
      },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function fetchOk(text: string) {
  return { ok: true, status: 200, text: async () => text, json: async () => ({}) };
}

function writtenSkills() {
  const lock = mockWriteLockfile.mock.calls[0][0] as {
    skills: Record<string, { sha: string; version: string; installedAt: string }>;
  };
  return lock.skills;
}

describe("updateCommand sha-mode parity (F4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallSymlink.mockReturnValue([]);
    mockDetectInstalledAgents.mockResolvedValue(AGENTS);
    mockGetDefaultBranch.mockResolvedValue("main");
    mockGetSkill.mockRejectedValue(new Error("not found"));
  });

  it("unchanged skill: no phantom update, lockfile sha stays install-time value", async () => {
    const installSha = computeSha(CONTENT); // what `vskill add` wrote
    mockReadLockfile.mockReturnValue(lockWithSha(installSha));
    mockFetch.mockResolvedValue(fetchOk(CONTENT)); // upstream unchanged

    const { updateCommand } = await import("../update.js");
    await updateCommand("myskill", { all: false });

    expect(mockInstallSymlink).not.toHaveBeenCalled();
    const skills = writtenSkills();
    expect(skills["myskill"].sha).toBe(installSha);
    expect(skills["myskill"].installedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("changed skill: real update, lockfile sha written in install (string) mode", async () => {
    const installSha = computeSha(CONTENT);
    mockReadLockfile.mockReturnValue(lockWithSha(installSha));
    mockFetch.mockResolvedValue(fetchOk(NEW_CONTENT)); // upstream changed

    const { updateCommand } = await import("../update.js");
    await updateCommand("myskill", { all: false });

    expect(mockInstallSymlink).toHaveBeenCalledTimes(1);
    const skills = writtenSkills();
    expect(skills["myskill"].sha).toBe(computeSha(NEW_CONTENT));
  });

  it("legacy files-map sha in lockfile: accepted as unchanged and healed to canonical", async () => {
    // A previous buggy update wrote the files-map sha into the lockfile.
    const legacySha = computeSha({ "SKILL.md": CONTENT });
    mockReadLockfile.mockReturnValue(lockWithSha(legacySha));
    mockFetch.mockResolvedValue(fetchOk(CONTENT)); // upstream unchanged

    const { updateCommand } = await import("../update.js");
    await updateCommand("myskill", { all: false });

    // No phantom re-install...
    expect(mockInstallSymlink).not.toHaveBeenCalled();
    const skills = writtenSkills();
    // ...but the lockfile sha self-heals to the canonical install identity.
    expect(skills["myskill"].sha).toBe(computeSha(CONTENT));
    expect(skills["myskill"].version).toBe("1.0.0");
    expect(skills["myskill"].installedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
