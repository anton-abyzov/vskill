// ---------------------------------------------------------------------------
// 0765: tests for the helpers wired into commands/update.ts that fix the
// "Update to <latest>" no-op bug.
//
// The full update loop has heavy IO + network coupling; these unit tests
// pin down the pure helpers (isVersionGreater, canonicalNameFromParsedSource,
// syncFrontmatterVersionAfterUpdate) so the install loop can rely on them.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isVersionGreater,
  canonicalNameFromParsedSource,
  syncFrontmatterVersionAfterUpdate,
} from "../update.js";

describe("0765 isVersionGreater", () => {
  it("strict semver greater-than", () => {
    expect(isVersionGreater("1.0.3", "1.0.2")).toBe(true);
    expect(isVersionGreater("1.0.2", "1.0.3")).toBe(false);
    expect(isVersionGreater("1.0.2", "1.0.2")).toBe(false);
  });

  it("compares major/minor/patch in order", () => {
    expect(isVersionGreater("2.0.0", "1.99.99")).toBe(true);
    expect(isVersionGreater("1.10.0", "1.9.99")).toBe(true);
    expect(isVersionGreater("1.0.10", "1.0.9")).toBe(true);
    expect(isVersionGreater("1.9.99", "1.10.0")).toBe(false);
  });

  it("handles missing operands safely (no crash)", () => {
    expect(isVersionGreater(null, null)).toBe(false);
    expect(isVersionGreater("1.0.0", null)).toBe(true);
    expect(isVersionGreater(null, "1.0.0")).toBe(false);
    expect(isVersionGreater("", "1.0.0")).toBe(false);
  });

  it("falls back to lexical compare for non-semver inputs", () => {
    expect(isVersionGreater("foo", "bar")).toBe(true);
    expect(isVersionGreater("bar", "foo")).toBe(false);
  });
});

describe("0765 canonicalNameFromParsedSource", () => {
  it("github source → owner/repo/skill", () => {
    expect(
      canonicalNameFromParsedSource(
        { type: "github", owner: "anton-abyzov", repo: "greet-anton" },
        "greet-anton",
      ),
    ).toBe("anton-abyzov/greet-anton/greet-anton");
  });

  it("github-plugin and marketplace also resolve to canonical", () => {
    expect(
      canonicalNameFromParsedSource(
        { type: "github-plugin", owner: "ant", repo: "vskill" },
        "scout",
      ),
    ).toBe("ant/vskill/scout");
    expect(
      canonicalNameFromParsedSource(
        { type: "marketplace", owner: "anthropics", repo: "skills" },
        "skill-creator",
      ),
    ).toBe("anthropics/skills/skill-creator");
  });

  it("missing owner or repo → null (don't construct partial paths)", () => {
    expect(
      canonicalNameFromParsedSource({ type: "github", owner: null, repo: "x" }, "n"),
    ).toBeNull();
    expect(
      canonicalNameFromParsedSource({ type: "github", owner: "x", repo: null }, "n"),
    ).toBeNull();
  });

  it("non-github source types → null", () => {
    expect(
      canonicalNameFromParsedSource({ type: "registry", owner: "x", repo: "y" }, "n"),
    ).toBeNull();
    expect(
      canonicalNameFromParsedSource({ type: "unknown", owner: "x", repo: "y" }, "n"),
    ).toBeNull();
  });
});

describe("0765 syncFrontmatterVersionAfterUpdate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vskill-update-0765-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setupSkill(agentDir: string, name: string, frontmatter: string): string {
    const skillDir = join(tmp, agentDir, name);
    mkdirSync(skillDir, { recursive: true });
    const path = join(skillDir, "SKILL.md");
    writeFileSync(path, frontmatter, "utf8");
    return path;
  }

  it("AC-US2-01: rewrites version when on-disk frontmatter doesn't match newVersion", () => {
    // Given an agent's SKILL.md with version: "1.0.2",
    // When syncFrontmatterVersionAfterUpdate runs with newVersion=1.0.3,
    // Then the file ends with version: "1.0.3".
    const path = setupSkill(
      ".claude/skills",
      "greet-anton",
      `---\nversion: "1.0.2"\nname: greet-anton\n---\n\nbody\n`,
    );

    syncFrontmatterVersionAfterUpdate(
      [{ localSkillsDir: ".claude/skills" }],
      tmp,
      "greet-anton",
      "1.0.3",
    );

    const after = readFileSync(path, "utf8");
    expect(after).toContain('version: "1.0.3"');
    expect(after).not.toContain('version: "1.0.2"');
    expect(after).toContain("name: greet-anton");
    expect(after).toContain("body");
  });

  it("inserts version when frontmatter exists but has no version field", () => {
    const path = setupSkill(
      ".claude/skills",
      "scout",
      `---\nname: scout\ndescription: "find things"\n---\n\nbody\n`,
    );

    syncFrontmatterVersionAfterUpdate(
      [{ localSkillsDir: ".claude/skills" }],
      tmp,
      "scout",
      "1.0.3",
    );

    const after = readFileSync(path, "utf8");
    expect(after).toMatch(/^---\s*\nversion: "1.0.3"\nname: scout/);
  });

  it("no-op when on-disk version already matches newVersion (idempotent)", () => {
    const path = setupSkill(
      ".claude/skills",
      "greet-anton",
      `---\nversion: "1.0.3"\nname: greet-anton\n---\n\nbody\n`,
    );
    const before = readFileSync(path, "utf8");

    syncFrontmatterVersionAfterUpdate(
      [{ localSkillsDir: ".claude/skills" }],
      tmp,
      "greet-anton",
      "1.0.3",
    );

    const after = readFileSync(path, "utf8");
    expect(after).toBe(before);
  });

  it("syncs across multiple agents", () => {
    const a = setupSkill(".claude/skills", "scout", `---\nversion: "1.0.2"\n---\n`);
    const b = setupSkill(".cursor/skills", "scout", `---\nversion: "1.0.1"\n---\n`);
    const c = setupSkill(".windsurf/skills", "scout", `---\nname: scout\n---\n`);

    syncFrontmatterVersionAfterUpdate(
      [
        { localSkillsDir: ".claude/skills" },
        { localSkillsDir: ".cursor/skills" },
        { localSkillsDir: ".windsurf/skills" },
      ],
      tmp,
      "scout",
      "1.0.3",
    );

    expect(readFileSync(a, "utf8")).toContain('version: "1.0.3"');
    expect(readFileSync(b, "utf8")).toContain('version: "1.0.3"');
    expect(readFileSync(c, "utf8")).toContain('version: "1.0.3"');
  });

  it("silently skips agents where SKILL.md doesn't exist", () => {
    // No SKILL.md created — function should not throw.
    expect(() =>
      syncFrontmatterVersionAfterUpdate(
        [{ localSkillsDir: ".does-not-exist/skills" }],
        tmp,
        "ghost",
        "1.0.3",
      ),
    ).not.toThrow();
  });
});
