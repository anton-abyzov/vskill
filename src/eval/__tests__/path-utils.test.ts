// ---------------------------------------------------------------------------
// 0686 T-013: expandHome + resolveGlobalSkillsDir cross-platform coverage.
//
// Mocks `node:os` via vi.mock + vi.hoisted so `os.platform()` + `os.homedir()`
// can be swapped per-test. This keeps the win32 path matrix exercisable on
// darwin CI hosts (AC-US7-05).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";

const osMocks = vi.hoisted(() => ({
  platformFn: vi.fn<() => NodeJS.Platform>(() => "darwin"),
  homedirFn: vi.fn<() => string>(() => "/Users/me"),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:os");
  const merged = {
    ...actual,
    platform: osMocks.platformFn,
    homedir: osMocks.homedirFn,
  };
  return { ...merged, default: merged };
});

const { expandHome, resolveGlobalSkillsDir } = await import("../path-utils.js");
const { AGENTS_REGISTRY } = await import("../../agents/agents-registry.js");
type AgentDefinition = typeof AGENTS_REGISTRY[number];

const POSIX_DARWIN_HOME = "/Users/me";
const POSIX_LINUX_HOME = "/home/me";
const WIN32_HOME = "C:\\Users\\me";

function mockPlatform(platform: NodeJS.Platform, home: string): void {
  osMocks.platformFn.mockReturnValue(platform);
  osMocks.homedirFn.mockReturnValue(home);
}

afterEach(() => {
  osMocks.platformFn.mockReset();
  osMocks.homedirFn.mockReset();
});

// ---------------------------------------------------------------------------
// expandHome
// ---------------------------------------------------------------------------

describe("expandHome (0686 AC-US7-01..02)", () => {
  it("returns darwin home-rooted path for ~/.claude/skills", () => {
    mockPlatform("darwin", POSIX_DARWIN_HOME);
    expect(expandHome("~/.claude/skills")).toBe("/Users/me/.claude/skills");
  });

  it("returns linux home-rooted path for ~/.claude/skills", () => {
    mockPlatform("linux", POSIX_LINUX_HOME);
    expect(expandHome("~/.claude/skills")).toBe("/home/me/.claude/skills");
  });

  it("returns win32 backslash path for ~/.claude/skills", () => {
    mockPlatform("win32", WIN32_HOME);
    expect(expandHome("~/.claude/skills")).toBe("C:\\Users\\me\\.claude\\skills");
  });

  it("expands bare tilde to homedir", () => {
    mockPlatform("darwin", POSIX_DARWIN_HOME);
    expect(expandHome("~")).toBe(POSIX_DARWIN_HOME);
  });

  it("passes through absolute paths unchanged", () => {
    mockPlatform("linux", POSIX_LINUX_HOME);
    expect(expandHome("/var/log")).toBe("/var/log");
  });

  it("passes through relative paths unchanged", () => {
    mockPlatform("linux", POSIX_LINUX_HOME);
    expect(expandHome("./rel/path")).toBe("./rel/path");
  });

  it("handles backslash-separated tilde input on win32", () => {
    mockPlatform("win32", WIN32_HOME);
    expect(expandHome("~\\.cursor\\skills")).toBe("C:\\Users\\me\\.cursor\\skills");
  });

  it("produces absolute paths on all platforms for typical registry entries", () => {
    mockPlatform("darwin", POSIX_DARWIN_HOME);
    expect(path.posix.isAbsolute(expandHome("~/.cursor/skills"))).toBe(true);
    mockPlatform("linux", POSIX_LINUX_HOME);
    expect(path.posix.isAbsolute(expandHome("~/.cursor/skills"))).toBe(true);
    mockPlatform("win32", WIN32_HOME);
    expect(path.win32.isAbsolute(expandHome("~/.cursor/skills"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveGlobalSkillsDir
// ---------------------------------------------------------------------------

const TEST_AGENT_CLAUDE: AgentDefinition = {
  id: "claude-code",
  displayName: "Claude Code",
  localSkillsDir: ".claude/skills",
  globalSkillsDir: "~/.claude/skills",
  isUniversal: false,
  detectInstalled: "which claude",
  parentCompany: "Anthropic",
  featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
};

const TEST_AGENT_POSIX_CONFIG: AgentDefinition = {
  id: "amp",
  displayName: "Amp",
  localSkillsDir: ".amp/skills",
  globalSkillsDir: "~/.config/agents/skills",
  isUniversal: true,
  detectInstalled: "which amp",
  parentCompany: "Sourcegraph",
  featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
};

const TEST_AGENT_WITH_OVERRIDE: AgentDefinition = {
  id: "myagent",
  displayName: "My Agent",
  localSkillsDir: ".myagent/skills",
  globalSkillsDir: "~/.config/myagent/skills",
  win32PathOverride: "~/.myagent/skills",
  isUniversal: false,
  detectInstalled: "which myagent",
  parentCompany: "Me",
  featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
};

describe("resolveGlobalSkillsDir (0686 AC-US7-03..04)", () => {
  it("darwin: resolves ~/.claude/skills to /Users/me/.claude/skills", () => {
    mockPlatform("darwin", POSIX_DARWIN_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_CLAUDE)).toBe("/Users/me/.claude/skills");
  });

  it("linux: resolves ~/.claude/skills to /home/me/.claude/skills", () => {
    mockPlatform("linux", POSIX_LINUX_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_CLAUDE)).toBe("/home/me/.claude/skills");
  });

  it("win32: resolves ~/.claude/skills to C:\\Users\\me\\.claude\\skills", () => {
    mockPlatform("win32", WIN32_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_CLAUDE)).toBe("C:\\Users\\me\\.claude\\skills");
  });

  it("win32: maps ~/.config/agents/skills to %APPDATA% fallback", () => {
    mockPlatform("win32", WIN32_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_POSIX_CONFIG)).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\agents\\skills",
    );
  });

  it("win32: win32PathOverride wins over globalSkillsDir", () => {
    mockPlatform("win32", WIN32_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_WITH_OVERRIDE)).toBe(
      "C:\\Users\\me\\.myagent\\skills",
    );
  });

  it("darwin: win32PathOverride is ignored on non-win32", () => {
    mockPlatform("darwin", POSIX_DARWIN_HOME);
    expect(resolveGlobalSkillsDir(TEST_AGENT_WITH_OVERRIDE)).toBe(
      "/Users/me/.config/myagent/skills",
    );
  });

  it("on all platforms: returns an absolute, tilde-free path for every registry entry", () => {
    const platforms: Array<{ platform: NodeJS.Platform; home: string; isAbsolute: (p: string) => boolean }> = [
      { platform: "darwin", home: POSIX_DARWIN_HOME, isAbsolute: path.posix.isAbsolute },
      { platform: "linux", home: POSIX_LINUX_HOME, isAbsolute: path.posix.isAbsolute },
      { platform: "win32", home: WIN32_HOME, isAbsolute: path.win32.isAbsolute },
    ];

    for (const { platform, home, isAbsolute } of platforms) {
      mockPlatform(platform, home);
      for (const agent of AGENTS_REGISTRY) {
        const resolved = resolveGlobalSkillsDir(agent);
        expect(
          isAbsolute(resolved),
          `agent=${agent.id} platform=${platform} resolved=${resolved}`,
        ).toBe(true);
        expect(resolved).not.toContain("~");
      }
    }
  });
});
