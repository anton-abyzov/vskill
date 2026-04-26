// ---------------------------------------------------------------------------
// 0769 T-005: skill-resolver allowlist — registry-driven resolution for skills
// living outside the studio root (e.g. plugin-cache snapshots) plus
// path-traversal hardening.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { resolveAllowedSkillDir } from "../skill-resolver.js";
import { setSkillDirEntry, clearSkillDirRegistry } from "../skill-dir-registry.js";

let workspace: string;

beforeEach(() => {
  clearSkillDirRegistry();
  workspace = mkdtempSync(join(tmpdir(), "vskill-0769-allowlist-"));
});

afterEach(() => {
  clearSkillDirRegistry();
  rmSync(workspace, { recursive: true, force: true });
});

function writeSkill(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# test");
}

describe("resolveAllowedSkillDir (0769 T-005)", () => {
  it("returns the registered absolute dir when it falls under the allowlist", () => {
    const cacheDir = join(workspace, "fakehome", ".claude/plugins/cache/mp/p/1.0.0/skills/s");
    writeSkill(cacheDir);
    setSkillDirEntry("p", "s", { dir: cacheDir, origin: "installed" });

    const allowedRoots = [
      join(workspace, "studio-root"),
      join(workspace, "fakehome", ".claude/plugins/cache"),
      join(workspace, "fakehome", ".claude/plugins/marketplaces"),
      join(workspace, "fakehome", ".claude/skills"),
    ];

    const resolved = resolveAllowedSkillDir(
      join(workspace, "studio-root"),
      "p",
      "s",
      allowedRoots,
    );
    expect(resolved).toBe(cacheDir);
  });

  it("falls back to the root-based resolveSkillDir when no registry entry exists", () => {
    // No setSkillDirEntry call — registry is empty.
    const studioRoot = join(workspace, "studio-root");
    const flatLayout = join(studioRoot, "my-skill");
    writeSkill(flatLayout);

    const resolved = resolveAllowedSkillDir(studioRoot, "anything", "my-skill", [studioRoot]);
    expect(resolved).toBe(flatLayout);
  });

  it("rejects a registered path containing '..'", () => {
    const allowedRoots = [join(workspace, "fakehome", ".claude/plugins/cache")];
    setSkillDirEntry("p", "s", {
      dir: join(workspace, "fakehome", ".claude/plugins/cache/mp/../../../etc/passwd"),
    });

    expect(() =>
      resolveAllowedSkillDir(join(workspace, "studio-root"), "p", "s", allowedRoots),
    ).toThrow(/traversal|outside allowlist/i);
  });

  it("rejects a registered path that escapes the allowlist", () => {
    const allowedRoots = [join(workspace, "fakehome", ".claude/plugins/cache")];
    const escapeDir = join(workspace, "elsewhere", "evil");
    writeSkill(escapeDir);
    setSkillDirEntry("p", "s", { dir: escapeDir });

    expect(() =>
      resolveAllowedSkillDir(join(workspace, "studio-root"), "p", "s", allowedRoots),
    ).toThrow(/outside allowlist/i);
  });

  // Symlink-escape test only on POSIX.
  const symlinkIt = platform() === "win32" ? it.skip : it;
  symlinkIt("rejects a symlink whose realpath escapes the allowlist", () => {
    const allowedRoot = join(workspace, "fakehome", ".claude/plugins/cache");
    mkdirSync(allowedRoot, { recursive: true });

    const realEvil = join(workspace, "evil-target");
    writeSkill(realEvil);

    const symlinkInside = join(allowedRoot, "mp", "p", "1.0.0", "skills", "s");
    mkdirSync(join(symlinkInside, ".."), { recursive: true });
    symlinkSync(realEvil, symlinkInside);

    setSkillDirEntry("p", "s", { dir: symlinkInside });

    expect(() =>
      resolveAllowedSkillDir(join(workspace, "studio-root"), "p", "s", [allowedRoot]),
    ).toThrow(/outside allowlist/i);
  });

  it("accepts a registered path that resolves cleanly inside the allowlist", () => {
    const allowedRoot = join(workspace, "fakehome", ".claude/plugins/marketplaces");
    const skillDir = join(allowedRoot, "claude-plugins-official", "plugins", "skill-creator", "skills", "skill-creator");
    writeSkill(skillDir);
    setSkillDirEntry("skill-creator", "skill-creator", { dir: skillDir });

    const resolved = resolveAllowedSkillDir(
      join(workspace, "studio-root"),
      "skill-creator",
      "skill-creator",
      [allowedRoot],
    );
    expect(resolved).toBe(skillDir);
  });
});
