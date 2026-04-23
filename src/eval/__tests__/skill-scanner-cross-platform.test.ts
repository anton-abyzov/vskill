// ---------------------------------------------------------------------------
// 0686: skill-scanner + path-utils cross-platform contract.
//
// The scanner uses resolveGlobalSkillsDir() from path-utils for its global
// scope. This test mocks node:os so we can assert (on a darwin CI) that:
//   - a win32 mock resolves ~/.claude/skills to a backslash path
//   - the scanner surfaces the platform-correct absolute path in SkillInfo.dir
//   - tilde is never present in returned dir strings
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

afterEach(() => {
  osMocks.platformFn.mockReset();
  osMocks.homedirFn.mockReset();
});

describe("path-utils cross-platform matrix (0686 AC-US7-05)", () => {
  it("darwin: ~/.claude/skills → /Users/me/.claude/skills", () => {
    osMocks.platformFn.mockReturnValue("darwin");
    osMocks.homedirFn.mockReturnValue("/Users/me");
    expect(expandHome("~/.claude/skills")).toBe("/Users/me/.claude/skills");
  });

  it("linux: ~/.claude/skills → /home/me/.claude/skills", () => {
    osMocks.platformFn.mockReturnValue("linux");
    osMocks.homedirFn.mockReturnValue("/home/me");
    expect(expandHome("~/.claude/skills")).toBe("/home/me/.claude/skills");
  });

  it("win32: ~/.claude/skills → C:\\Users\\me\\.claude\\skills", () => {
    osMocks.platformFn.mockReturnValue("win32");
    osMocks.homedirFn.mockReturnValue("C:\\Users\\me");
    expect(expandHome("~/.claude/skills")).toBe("C:\\Users\\me\\.claude\\skills");
  });

  it("49-agent resolveGlobalSkillsDir is absolute + tilde-free on all platforms", () => {
    const suites: Array<{
      platform: NodeJS.Platform;
      home: string;
      isAbsolute: (p: string) => boolean;
    }> = [
      { platform: "darwin", home: "/Users/me", isAbsolute: path.posix.isAbsolute },
      { platform: "linux", home: "/home/me", isAbsolute: path.posix.isAbsolute },
      { platform: "win32", home: "C:\\Users\\me", isAbsolute: path.win32.isAbsolute },
    ];

    for (const { platform, home, isAbsolute } of suites) {
      osMocks.platformFn.mockReturnValue(platform);
      osMocks.homedirFn.mockReturnValue(home);
      for (const agent of AGENTS_REGISTRY) {
        const resolved = resolveGlobalSkillsDir(agent);
        expect(
          isAbsolute(resolved),
          `platform=${platform} agent=${agent.id} resolved=${resolved}`,
        ).toBe(true);
        expect(resolved).not.toContain("~");
      }
    }
  });

  it("scanner uses resolved home dir — cross-platform call works with injected home", async () => {
    // The scanner accepts `home` as an option for test determinism. On real
    // runtime it falls back to `resolveGlobalSkillsDir(agent)`, which in turn
    // uses the mocked os.homedir()/platform. This test proves the injection
    // path (covered end-to-end under tmpdir-style fixtures in the tri-scope
    // suite) is separable from the os.homedir() fallback path.
    osMocks.platformFn.mockReturnValue("darwin");
    osMocks.homedirFn.mockReturnValue(tmpdir());

    const fakeHome = mkdtempSync(join(tmpdir(), "vskill-cp-home-"));
    const root = mkdtempSync(join(tmpdir(), "vskill-cp-root-"));
    try {
      const dir = join(fakeHome, ".claude/skills/cp-skill");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), "# cp");

      const { scanSkillsTriScope } = await import("../skill-scanner.js");
      const skills = await scanSkillsTriScope(root, {
        agentId: "claude-code",
        home: fakeHome,
      });
      const s = skills.find((x) => x.skill === "cp-skill");
      expect(s?.scope).toBe("global");
      expect(s?.dir).not.toContain("~");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});
