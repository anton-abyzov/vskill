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

vi.mock("node:crypto", () => ({
  createHash: () => {
    const obj = {
      update: vi.fn().mockImplementation(() => obj),
      digest: vi.fn().mockReturnValue("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"),
    };
    return obj;
  },
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
const mockCheckInstallSafety = vi.fn();
vi.mock("../blocklist/blocklist.js", () => ({
  checkBlocklist: (...args: unknown[]) => mockCheckBlocklist(...args),
  checkInstallSafety: (...args: unknown[]) => mockCheckInstallSafety(...args),
}));

const mockCheckPlatformSecurity = vi.fn();
vi.mock("../security/index.js", () => ({
  checkPlatformSecurity: (...args: unknown[]) => mockCheckPlatformSecurity(...args),
}));

const mockGetSkill = vi.fn();
vi.mock("../api/client.js", () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
  reportInstall: vi.fn().mockResolvedValue(undefined),
  reportInstallBatch: vi.fn().mockResolvedValue(undefined),
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
  mockCheckInstallSafety.mockResolvedValue({ blocked: false, rejected: false });
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
  it("prompts for agents and method by default for multi-skill repos", async () => {
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
      .mockResolvedValueOnce(0)  // scope: Project
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

    // 1 detected + 1 undetected from registry → agent checkbox + scope + skill checkbox
    // (method prompt suppressed because user picks a single agent)
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected only
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project

    await addCommand("owner/repo", { select: true });

    // Scope only (method skipped for single agent)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
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

// 0742: regression — non-TTY runs (e.g. piped, run via Claude Code's bash tool,
// nested npx subprocess) used to silently fan out to every detected agent,
// leaving leftover symlinks for agents the user never opted into. Default to
// claude-code-only when the user didn't pass --yes (CI opt-in) or --agent.
describe("wizard integration: non-TTY guards against silent multi-agent fanout (0742)", () => {
  it("installs to claude-code only when non-TTY + multiple detected + no --yes/--agent", async () => {
    mockIsTTY.mockReturnValue(false);
    const agents = [
      makeAgent(),
      makeAgent({ id: "cursor", displayName: "Cursor", localSkillsDir: ".cursor/skills" }),
      makeAgent({ id: "codex", displayName: "Codex", localSkillsDir: ".codex/skills" }),
      makeAgent({ id: "opencode", displayName: "OpenCode", localSkillsDir: ".opencode/skills" }),
    ];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    await addCommand("owner/repo", {});

    // Should call install with exactly one agent (claude-code), NOT all 4
    const installCall = mockInstallSymlink.mock.calls[0] ?? mockInstallCopy.mock.calls[0];
    expect(installCall, "install was never called").toBeDefined();
    const passedAgents = installCall![2] as Array<{ id: string }>;
    expect(passedAgents).toHaveLength(1);
    expect(passedAgents[0].id).toBe("claude-code");
  });

  it("preserves explicit --yes opt-in: fans out to all detected agents", async () => {
    mockIsTTY.mockReturnValue(false);
    const agents = [
      makeAgent(),
      makeAgent({ id: "cursor", displayName: "Cursor", localSkillsDir: ".cursor/skills" }),
    ];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    await addCommand("owner/repo", { yes: true });

    const installCall = mockInstallSymlink.mock.calls[0] ?? mockInstallCopy.mock.calls[0];
    expect(installCall).toBeDefined();
    const passedAgents = installCall![2] as Array<{ id: string }>;
    expect(passedAgents).toHaveLength(2);
  });

  it("non-TTY single-agent install is unaffected by the guard", async () => {
    mockIsTTY.mockReturnValue(false);
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    await addCommand("owner/repo", {});

    const installCall = mockInstallSymlink.mock.calls[0] ?? mockInstallCopy.mock.calls[0];
    expect(installCall).toBeDefined();
    const passedAgents = installCall![2] as Array<{ id: string }>;
    expect(passedAgents.map((a) => a.id)).toEqual(["claude-code"]);
  });
});

describe("wizard integration: single skill + single agent prompts only scope", () => {
  it("shows agent checkbox + scope, suppresses method prompt for single agent", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "only-skill", rawUrl: "https://raw.githubusercontent.com/o/r/main/SKILL.md" },
    ]);

    // 1 detected + 1 undetected → agent checkbox shown
    mockPromptCheckboxList.mockResolvedValueOnce([0]); // agents: select detected
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project

    await addCommand("owner/repo", {});

    // Agent checkbox shown (detected + undetected agents in list)
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(1);
    // Scope only (method skipped for single agent)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
  });
});

describe("wizard integration: --agent flag skips agent selection", () => {
  it("does not prompt for agents; method prompt suppressed when --agent narrows to one", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Scope + skill selection (no agent checkbox since --agent; no method since single agent)
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project
    mockPromptCheckboxList.mockResolvedValue([0, 1]); // select all skills

    await addCommand("owner/repo", { agent: ["claude-code"] });

    // Skill checkbox called, agent checkbox NOT called (--agent flag)
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(1);
    // Scope only (method skipped for single agent)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
  });
});

describe("wizard integration: --global flag skips scope selection", () => {
  it("skips scope due to --global; method also skipped for single agent → no choice prompts", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
      { name: "skill-b", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-b/SKILL.md" },
    ]);

    // Agent checkbox + skill checkbox (no scope since --global, no method since single agent)
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected
      .mockResolvedValueOnce([0, 1]); // skills

    await addCommand("owner/repo", { global: true, select: true });

    // No promptChoice calls: scope skipped by --global, method skipped by single-agent rule
    expect(mockPromptChoice).not.toHaveBeenCalled();
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

// TC-014: Single-agent detected shows agents + scope + skills (method prompt suppressed)
describe("wizard integration: TC-014 single-agent prompts agents + scope + skills", () => {
  it("shows agent checkbox with detected+undetected, scope, skills; suppresses method prompt", async () => {
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
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project

    await addCommand("owner/repo", {});

    // Agent checkbox + skill checkbox
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
    // Scope only (method skipped for single agent)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
    // Installation proceeded (via canonical installer)
    expect(mockInstallSymlink).toHaveBeenCalled();
  });
});

// TC-015: Multi-agent shows agents + method + skills
describe("wizard integration: TC-015 multi-agent prompts agents + method + skills", () => {
  it("shows agent checkbox, method selection, and skill checkbox", async () => {
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
      .mockResolvedValueOnce(0)  // scope: Project
      .mockResolvedValueOnce(0); // method: symlink

    await addCommand("owner/repo", {});

    // Two checkbox prompts: agents + skills
    expect(mockPromptCheckboxList).toHaveBeenCalledTimes(2);
    // Scope + method prompts
    expect(mockPromptChoice).toHaveBeenCalledTimes(2);
  });
});

// TC-014b: Single-agent skips method prompt (Symlink-vs-Copy is meaningless for one agent)
describe("wizard integration: TC-014b single-agent skips method prompt", () => {
  it("does not prompt for method when only one agent is selected", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    mockPromptCheckboxList
      .mockResolvedValueOnce([0])  // agents: select detected only
      .mockResolvedValueOnce([0]); // skills
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project

    await addCommand("owner/repo", {});

    // Only the scope prompt should fire — method prompt is suppressed for single agent
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
    expect(mockPromptChoice).toHaveBeenNthCalledWith(1, "Installation scope:", expect.any(Array));
    expect(mockPromptChoice).not.toHaveBeenCalledWith("Installation method:", expect.any(Array));
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

    // Agent checkbox + skill checkbox (scope shown, method skipped since --copy)
    mockPromptCheckboxList
      .mockResolvedValueOnce([0])     // agents: select detected
      .mockResolvedValueOnce([0, 1]); // skills
    mockPromptChoice.mockResolvedValueOnce(0); // scope: Project (method skipped by --copy)

    // Should not throw - --copy is a valid flag
    await addCommand("owner/repo", { copy: true });

    // Scope prompt only (method skipped by --copy)
    expect(mockPromptChoice).toHaveBeenCalledTimes(1);
    // Uses installCopy, not installSymlink
    expect(mockInstallCopy).toHaveBeenCalled();
    expect(mockInstallSymlink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: scope prompt behavior (T-006)
// ---------------------------------------------------------------------------

describe("wizard integration: scope prompt shown with correct options", () => {
  it("prompts for scope with Project and Global options when no flags set", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    mockPromptCheckboxList.mockResolvedValueOnce([0]); // agents
    mockPromptChoice
      .mockResolvedValueOnce(0)  // scope: Project
      .mockResolvedValueOnce(0); // method: Symlink

    await addCommand("owner/repo", {});

    // Scope prompt is the first promptChoice call
    expect(mockPromptChoice).toHaveBeenNthCalledWith(1, "Installation scope:", [
      { label: "Project", hint: "install in current project root" },
      { label: "Global", hint: "install in user home directory" },
    ]);
  });
});

describe("wizard integration: --cwd flag skips scope prompt", () => {
  it("does not prompt for scope when --cwd is provided", async () => {
    const agents = [makeAgent()];
    mockDetectInstalledAgents.mockResolvedValue(agents);
    mockDiscoverSkills.mockResolvedValue([
      { name: "skill-a", rawUrl: "https://raw.githubusercontent.com/o/r/main/skills/skill-a/SKILL.md" },
    ]);

    mockPromptCheckboxList.mockResolvedValueOnce([0]); // agents

    await addCommand("owner/repo", { cwd: "/some/path" });

    // No promptChoice calls: scope skipped by --cwd, method skipped by single-agent rule
    expect(mockPromptChoice).not.toHaveBeenCalled();
  });
});
