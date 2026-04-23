// ---------------------------------------------------------------------------
// 0686 T-004: symlink + installMethod detection in skill-scanner.
//
// Verifies:
//   - isSymlink + symlinkTarget populated from fs.lstatSync + fs.realpathSync
//   - installMethod flips to "symlinked" for symlinked installed/global skills
//   - cyclic symlinks don't hang the scanner; symlinkTarget is null on cycle
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillsTriScope } from "../skill-scanner.js";

let tmpRoot: string;
let fakeHome: string;
let pluginCache: string;

function writeSkill(base: string, relDir: string, content = "# skill"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-symlink-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-symlink-home-"));
  pluginCache = mkdtempSync(join(tmpdir(), "vskill-symlink-cache-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(pluginCache, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("scanSkillsTriScope — symlink detection", () => {
  it("flags symlinked installed skill with isSymlink=true + absolute symlinkTarget", async () => {
    const canonical = writeSkill(pluginCache, "cache-skill");
    const parent = join(tmpRoot, ".claude/skills");
    mkdirSync(parent, { recursive: true });
    const linkPath = join(parent, "linked-skill");
    symlinkSync(canonical, linkPath, "dir");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    const linked = skills.find((s) => s.skill === "linked-skill");
    expect(linked).toBeDefined();
    expect(linked?.isSymlink).toBe(true);
    expect(linked?.installMethod).toBe("symlinked");
    expect(linked?.symlinkTarget).toBe(realpathSync(canonical));
    expect(linked?.symlinkTarget?.startsWith("/") || linked?.symlinkTarget?.match(/^[A-Z]:\\/)).toBeTruthy();
  });

  it("flags a copied (non-symlink) skill with isSymlink=false + installMethod='copied'", async () => {
    writeSkill(tmpRoot, ".claude/skills/copied-skill");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    const s = skills.find((x) => x.skill === "copied-skill");
    expect(s?.isSymlink).toBe(false);
    expect(s?.symlinkTarget).toBeNull();
    expect(s?.installMethod).toBe("copied");
  });

  it("authored (own-scope) skills always report installMethod='authored' + no symlink glyph", async () => {
    writeSkill(tmpRoot, "myplugin/skills/own-authored");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    const s = skills.find((x) => x.skill === "own-authored");
    expect(s?.installMethod).toBe("authored");
    expect(s?.isSymlink).toBe(false);
    expect(s?.symlinkTarget).toBeNull();
  });

  it("symlinked skill in the GLOBAL scope picks up isSymlink + target", async () => {
    const canonical = writeSkill(pluginCache, "global-cache-skill");
    const parent = join(fakeHome, ".claude/skills");
    mkdirSync(parent, { recursive: true });
    const linkPath = join(parent, "global-linked");
    symlinkSync(canonical, linkPath, "dir");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    const g = skills.find((s) => s.skill === "global-linked");
    expect(g?.scope).toBe("global");
    expect(g?.isSymlink).toBe(true);
    expect(g?.installMethod).toBe("symlinked");
    expect(g?.symlinkTarget).toBe(realpathSync(canonical));
  });

  it("handles a broken symlink (target does not exist) without throwing", async () => {
    const parent = join(tmpRoot, ".claude/skills");
    mkdirSync(parent, { recursive: true });
    const bogus = join(pluginCache, "does-not-exist");
    const linkPath = join(parent, "broken-link");
    symlinkSync(bogus, linkPath, "dir");

    // Scanner shouldn't blow up. The skill is skipped (no SKILL.md), but the
    // scan itself must complete.
    await expect(
      scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome }),
    ).resolves.toBeInstanceOf(Array);
  });

  it("detects a cyclic symlink and sets symlinkTarget=null without hanging", async () => {
    // Create a cycle: A → B → A inside tmpRoot/.claude/skills/cycle-a
    const parent = join(tmpRoot, ".claude/skills");
    mkdirSync(parent, { recursive: true });
    const a = join(parent, "cycle-a");
    const b = join(parent, "cycle-b");
    symlinkSync(b, a, "dir");
    symlinkSync(a, b, "dir");

    // Plant a non-cyclic valid skill too so we can assert the scan didn't
    // silently drop everything.
    writeSkill(tmpRoot, ".claude/skills/normal-skill");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    expect(skills.some((s) => s.skill === "normal-skill")).toBe(true);

    // cycle-a/cycle-b: either skipped (no SKILL.md resolvable) or present
    // with installMethod=symlinked + symlinkTarget=null. Both are acceptable
    // — the key is the scan completes.
    const cyclic = skills.filter((s) => s.skill === "cycle-a" || s.skill === "cycle-b");
    for (const c of cyclic) {
      expect(c.installMethod).toBe("symlinked");
      expect(c.symlinkTarget).toBeNull();
    }
  });
});
