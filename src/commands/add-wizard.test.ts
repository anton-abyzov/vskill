import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockChmodSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockStatSync = vi.fn();
const mockCopyFileSync = vi.fn();
const mockRmSync = vi.fn();

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  copyFileSync: (...args: unknown[]) => mockCopyFileSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
}));

vi.mock("node:path", async () => {
  const actual = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...actual };
});

const mockDigest = vi.fn().mockReturnValue("abcdef123456xxxx");
const mockUpdate = vi.fn().mockReturnValue({ digest: mockDigest });
vi.mock("node:crypto", () => ({
  createHash: () => ({ update: mockUpdate }),
}));

// ---------------------------------------------------------------------------
// Mock agents registry
// ---------------------------------------------------------------------------
const mockDetectInstalledAgents = vi.fn();
vi.mock("../agents/agents-registry.js", () => ({
  detectInstalledAgents: (...args: unknown[]) => mockDetectInstalledAgents(...args),
  AGENTS_REGISTRY: [
    { id: "claude-code", displayName: "Claude Code", isUniversal: false, parentCompany: "Anthropic", localSkillsDir: ".claude/commands", globalSkillsDir: "~/.claude/commands" },
    { id: "cursor", displayName: "Cursor", isUniversal: false, parentCompany: "Anysphere", localSkillsDir: ".cursor/commands", globalSkillsDir: "~/.cursor/commands" },
  ],
}));

// ---------------------------------------------------------------------------
// Mock lockfile
// ---------------------------------------------------------------------------
const mockEnsureLockfile = vi.fn();
const mockWriteLockfile = vi.fn();
vi.mock("../lockfile/index.js", () => ({
  ensureLockfile: (...args: unknown[]) => mockEnsureLockfile(...args),
  writeLockfile: (...args: unknown[]) => mockWriteLockfile(...args),
}));

// ---------------------------------------------------------------------------
// Mock scanner, blocklist, security, API client, discovery
// ---------------------------------------------------------------------------
const mockRunTier1Scan = vi.fn();
vi.mock("../scanner/index.js", () => ({
  runTier1Scan: (...args: unknown[]) => mockRunTier1Scan(...args),
}));

const mockCheckBlocklist = vi.fn();
vi.mock("../blocklist/blocklist.js", () => ({
  checkBlocklist: (...args: unknown[]) => mockCheckBlocklist(...args),
}));

const mockCheckPlatformSecurity = vi.fn();
vi.mock("../security/index.js", () => ({
  checkPlatformSecurity: (...args: unknown[]) => mockCheckPlatformSecurity(...args),
}));

const mockGetSkill = vi.fn();
vi.mock("../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

const mockDiscoverSkills = vi.fn();
vi.mock("../discovery/github-tree.js", () => ({
  discoverSkills: (...args: unknown[]) => mockDiscoverSkills(...args),
}));

// ---------------------------------------------------------------------------
// Mock project root & agent filter
// ---------------------------------------------------------------------------
const mockFindProjectRoot = vi.fn();
vi.mock("../utils/project-root.js", () => ({
  findProjectRoot: (...args: unknown[]) => mockFindProjectRoot(...args),
}));

const mockFilterAgents = vi.fn();
vi.mock("../utils/agent-filter.js", () => ({
  filterAgents: (...args: unknown[]) => mockFilterAgents(...args),
}));

// ---------------------------------------------------------------------------
// Mock output (suppress ANSI output)
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

// ---------------------------------------------------------------------------
// Mock prompts (to test wizard integration without real readline)
// ---------------------------------------------------------------------------
const mockPromptCheckboxList = vi.fn();
const mockPromptChoice = vi.fn();
const mockPromptConfirm = vi.fn();
const mockIsTTY = vi.fn();

vi.mock("../utils/prompts.js", () => ({
  isTTY: (...args: unknown[]) => mockIsTTY(...args),
  createPrompter: () => ({
    promptCheckboxList: (...args: unknown[]) => mockPromptCheckboxList(...args),
    promptChoice: (...args: unknown[]) => mockPromptChoice(...args),
    promptConfirm: (...args: unknown[]) => mockPromptConfirm(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Mock canonical installer
// ---------------------------------------------------------------------------
const mockInstallSymlink = vi.fn();
const mockInstallCopy = vi.fn();
vi.mock("../installer/canonical.js", () => ({
  installSymlink: (...args: unknown[]) => mockInstallSymlink(...args),
  installCopy: (...args: unknown[]) => mockInstallCopy(...args),
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------
const { addCommand } = await import("./add.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanResult(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "PASS",
    findings: [],
    score: 100,
    patternsChecked: 37,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    durationMs: 1,
    ...overrides,
  };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "claude-code",
    displayName: "Claude Code",
    localSkillsDir: ".claude/commands",
    globalSkillsDir: "~/.claude/commands",
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  // Default: safe skill content
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => "# Safe Skill\nNormal content",
  }) as unknown as typeof fetch;

  mockRunTier1Scan.mockReturnValue(makeScanResult());
  mockCheckBlocklist.mockResolvedValue(null);
  mockCheckPlatformSecurity.mockResolvedValue(null);
  mockEnsureLockfile.mockReturnValue({ skills: {}, agents: [] });
  mockFindProjectRoot.mockReturnValue("/projects/myapp");
  mockFilterAgents.mockImplementation((agents: unknown[]) => agents);

  // Default: TTY
  mockIsTTY.mockReturnValue(true);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests: interactive-first default (prompts in TTY)
// ---------------------------------------------------------------------------

describe("wizard integration: interactive by default in TTY", () => {
  it("prompts for agents and scope by default for multi-skill repos", async () => {
    const agents = [makeAgent(), makeAgent({ id: "cursor", displayName: "Cursor", localSkillsDir: ".cursor/skills" })];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Agent selection, scope selection, method selection, skill selection
    mockPromptCheckboxList
      .mockResolvedValueOnce([0, 1])  // agents
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", {});

    // Agent checkbox + skill checkbox
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
  });
});

describe("wizard integration: --yes flag (backward compat)", () => {
  it("skips all prompts when --yes is set", async () => {
    const agents = [makeAgent(), makeAgent({ id: "cursor", localSkillsDir: ".cursor/skills" })];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    await addCommand("owner/repo", { yes: true });

    expect(mockPromptCheckboxList).not.toHaveBeenCalled();
    expect(mockPromptChoice).not.toHaveBeenCalled();
    expect(mockPromptConfirm).not.toHaveBeenCalled();
  });
});

describe("wizard integration: --select is a no-op (interactive is default)", () => {
  it("shows same prompts with or without --select", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // 1 detected + 1 undetected from registry → agent checkbox + scope + method + skill checkbox
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected only
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", { select: true });

    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
    // Agent checkbox + skill checkbox
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
  });
});

describe("wizard integration: non-TTY mode", () => {
  it("skips prompts when stdin is not a TTY even with --select", async () => {
    mockIsTTY.mockReturnValue(false);
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    await addCommand("owner/repo", { select: true });

    expect(mockPromptCheckboxList).not.toHaveBeenCalled();
    expect(mockPromptChoice).not.toHaveBeenCalled();
    expect(mockPromptConfirm).not.toHaveBeenCalled();
  });
});

describe("wizard integration: single skill still prompts for scope", () => {
  it("shows scope prompt and agent checkbox for single-skill with undetected agents", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "only-skill", rawUrl: "https://raw.githubusercontent.com/o/r/main/SKILL.md" },
    ]);

    // 1 detected + 1 undetected → agent checkbox shown
    mockPromptCheckboxList.mockResolvedValueOnce([0]); // agents: select detected
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", {});

    // Agent checkbox shown (detected + undetected agents in list)
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(1);
    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
  });
});

describe("wizard integration: --agent flag skips agent selection", () => {
  it("does not prompt for agents but still prompts for scope and method", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Scope + method selection + skill selection (no agent checkbox since --agent)
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink
    mockPromptCheckboxList.mockResolvedValue([0, 1]); // select all skills

    await addCommand("owner/repo", { agent: ["claude-code"] });

    // Skill checkbox called, agent checkbox NOT called (--agent flag)
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(1);
    // Scope + method prompts shown
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
  });
});

describe("wizard integration: --global flag skips scope selection", () => {
  it("does not prompt for scope when --global is provided but still prompts for method", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Agent checkbox + skill checkbox (no scope since --global, but method is prompted)
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice.mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", { global: true, select: true });

    // Only method prompt (scope skipped due to --global)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
  });
});

describe("wizard integration: abort at agent selection", () => {
  it("exits cleanly when user selects no agents", async () => {
    const agents = [makeAgent(), makeAgent({ id: "cursor", displayName: "Cursor", localSkillsDir: ".cursor/skills" })];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    mockPromptCheckboxList.mockResolvedValueOnce([]); // user deselects all agents

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(addCommand("owner/repo", {})).rejects.toThrow("process.exit");
    mockExit.mockRestore();

    // No skills should have been installed
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
    expect(mockInstallCopy).not.toHaveBeenCalled();
  });
});

// TC-014: Single-agent detected shows agents + scope + skills (undetected shown too)
describe("wizard integration: TC-014 single-agent prompts agents + scope + skills", () => {
  it("shows agent checkbox with detected+undetected, scope, and skills", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Agent checkbox (detected + undetected) + skill checkbox
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected
      .mockResolvedValueOnce([0, 1]); // select both skills
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", {});

    // Agent checkbox + skill checkbox
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
    // Installation proceeded (via canonical installer)
    expect(mockInstallSymlink).toHaveBeenCalled();
  });
});

// TC-015: Multi-agent shows agents + scope + skills
describe("wizard integration: TC-015 multi-agent prompts agents + scope + skills", () => {
  it("shows agent checkbox, scope selection, and skill checkbox", async () => {
    const agents = [makeAgent(), makeAgent({ id: "cursor", displayName: "Cursor" })];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    mockPromptCheckboxList
      .mockResolvedValueOnce([0, 1])  // agents
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", {});

    // Two checkbox prompts: agents + skills
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
  });
});

// TC-016: --copy flag causes copy behavior instead of symlink
describe("wizard integration: TC-016 --copy flag", () => {
  it("accepts --copy flag, skips method prompt, uses installCopy", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Agent checkbox + skill checkbox + scope (no method since --copy)
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice.mockResolvedValueOnce(0); // scope: project (method skipped)

    // Should not throw - --copy is a valid flag
    await addCommand("owner/repo", { copy: true });

    // Method prompt skipped (only scope shown)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
    // Uses installCopy, not installSymlink
    expect(mockInstallCopy).toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
  });
});
