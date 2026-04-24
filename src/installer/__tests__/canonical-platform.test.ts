import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";

// 0706 T-004: the path-traversal guard in canonical.ts:resolveAgentSkillsDir()
// must work on Windows (backslash separators). The old check
// (`resolved.startsWith(normalizedRoot + "/")`) false-positives on Windows
// because `\` is the separator there. Replacement pattern: `path.relative()`.

const { resolveAgentSkillsDir } = await import("../canonical.js");

describe("resolveAgentSkillsDir path-traversal guard (0706 T-004)", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("accepts a legitimate nested install path on POSIX", () => {
    const agent = {
      id: "test",
      displayName: "Test",
      localSkillsDir: ".claude/skills",
      globalSkillsDir: "~/.claude/skills",
      isUniversal: false,
      detectInstalled: () => Promise.resolve(true),
      parentCompany: "Test",
      featureSupport: {
        slashCommands: false,
        hooks: false,
        mcp: false,
        customSystemPrompt: true,
      },
    };
    const out = resolveAgentSkillsDir(agent as any, {
      global: false,
      projectRoot: "/home/user/myproj",
    });
    expect(out).toContain(".claude/skills");
  });

  it("rejects a path that escapes the project root on POSIX", () => {
    const agent = {
      id: "evil",
      displayName: "Evil",
      localSkillsDir: "../../outside/skills",
      globalSkillsDir: "~/.evil/skills",
      isUniversal: false,
      detectInstalled: () => Promise.resolve(true),
      parentCompany: "Evil",
      featureSupport: {
        slashCommands: false,
        hooks: false,
        mcp: false,
        customSystemPrompt: true,
      },
    };
    expect(() =>
      resolveAgentSkillsDir(agent as any, {
        global: false,
        projectRoot: "/home/user/myproj",
      }),
    ).toThrow(/Path traversal/);
  });

  // The real smoke test for this fix: `path.relative()` handles Windows
  // backslashes correctly. We assert the underlying logic directly because
  // `resolveAgentSkillsDir` calls `join()` which uses native separators
  // (POSIX `/` on CI mac/linux), so we can't fake Windows paths in place.
  it("path.relative semantics: Windows-style backslash paths resolve to safe relative", () => {
    // Simulated Windows behavior. path.win32 gives us the backslash dialect.
    const normalizedRoot = "C:\\Users\\x\\.claude";
    const resolved = "C:\\Users\\x\\.claude\\skills\\foo";
    const rel = path.win32.relative(normalizedRoot, resolved);
    // Safe: does NOT start with ".."
    expect(rel.startsWith("..")).toBe(false);
  });

  it("path.relative semantics: Windows path escaping base starts with '..'", () => {
    const normalizedRoot = "C:\\Users\\x\\.claude";
    const resolved = "C:\\Windows\\System32";
    const rel = path.win32.relative(normalizedRoot, resolved);
    // Unsafe: starts with ".."
    expect(rel.startsWith("..")).toBe(true);
  });

  it("old `startsWith(normalizedRoot + '/')` check FAILS on Windows paths (regression guard)", () => {
    // Documents WHY the old code was broken: win paths use `\`, not `/`,
    // so the old string-prefix test never matched legit Windows installs.
    const normalizedRoot = "C:\\Users\\x\\.claude";
    const resolved = "C:\\Users\\x\\.claude\\skills\\foo";
    const oldGuardPasses = resolved.startsWith(normalizedRoot + "/");
    // Old guard falsely rejects a valid path.
    expect(oldGuardPasses).toBe(false);
    // New guard accepts it.
    const newGuardRejects = path.win32.relative(normalizedRoot, resolved).startsWith("..");
    expect(newGuardRejects).toBe(false);
  });
});
