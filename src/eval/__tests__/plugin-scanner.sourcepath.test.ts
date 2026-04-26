// ---------------------------------------------------------------------------
// 0769 T-001/T-003: scanInstalledPluginSkills sourcePath + lstat-derived
// installMethod.
//
// T-001: sourcePath should equal the marketplace clone path
//        (~/.claude/plugins/marketplaces/<mp>/plugins/<plugin>/skills/<skill>)
//        when it exists, and null when only the cache snapshot is present.
// T-003: installMethod should be lstat-derived ("copied" for plain dirs,
//        "symlinked" for actual symlinks) — NOT the hardcoded "symlinked"
//        the pre-0769 scanner emitted for everything.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { scanInstalledPluginSkills } from "../plugin-scanner.js";

let fakeHome: string;

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writeCacheSkill(home: string, mp: string, plugin: string, version: string, skill: string): string {
  const skillDir = join(home, ".claude/plugins/cache", mp, plugin, version, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);
  return skillDir;
}

function writeMarketplaceClone(home: string, mp: string, plugin: string, skill: string): string {
  const skillDir = join(home, ".claude/plugins/marketplaces", mp, "plugins", plugin, "skills", skill);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `# ${skill}`);
  return skillDir;
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-0769-sourcepath-"));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("scanInstalledPluginSkills sourcePath (0769 T-001)", () => {
  it("emits sourcePath = marketplace clone path when the clone exists", () => {
    writeCacheSkill(fakeHome, "claude-plugins-official", "skill-creator", "78497c524da3", "skill-creator");
    const expectedSource = writeMarketplaceClone(
      fakeHome,
      "claude-plugins-official",
      "skill-creator",
      "skill-creator",
    );

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].sourcePath).toBe(expectedSource);
  });

  it("emits sourcePath = null when the marketplace clone does NOT exist (cache only)", () => {
    writeCacheSkill(fakeHome, "claude-plugins-official", "skill-creator", "78497c524da3", "skill-creator");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].sourcePath).toBeNull();
  });

  it("translates cache marketplace name and plugin name into the marketplaces/plugins/skills layout", () => {
    // Layout sanity: cache uses <mp>/<plugin>/<ver>/skills/<skill>;
    // marketplaces uses <mp>/plugins/<plugin>/skills/<skill> (note "plugins/" segment).
    writeCacheSkill(fakeHome, "third-party-mp", "pdf", "2.0.0", "pdf");
    const expectedSource = writeMarketplaceClone(fakeHome, "third-party-mp", "pdf", "pdf");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].sourcePath).toBe(expectedSource);
    // sanity: sourcePath !== dir (marketplace path !== cache path)
    expect(out[0].sourcePath).not.toBe(out[0].dir);
  });
});

describe("scanInstalledPluginSkills lstat-derived installMethod (0769 T-003)", () => {
  it("emits installMethod = 'copied' for a plain directory cache snapshot", () => {
    writeCacheSkill(fakeHome, "claude-plugins-official", "skill-creator", "78497c524da3", "skill-creator");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].installMethod).toBe("copied");
  });

  // Symlink test only on POSIX — Windows symlinks need elevated privileges in CI.
  const symlinkIt = platform() === "win32" ? it.skip : it;
  symlinkIt("emits installMethod = 'symlinked' when the cache skill dir is itself a symlink", () => {
    // Realm: user manually `ln -s`'d a marketplace clone into the cache path
    // (rare, but the lstat truth must surface).
    const realDir = join(fakeHome, "real-skill-source");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(join(realDir, "SKILL.md"), "# real");

    const cacheSkillsDir = join(
      fakeHome,
      ".claude/plugins/cache/manual-mp/manual-plugin/9.9.9/skills",
    );
    mkdirSync(cacheSkillsDir, { recursive: true });
    symlinkSync(realDir, join(cacheSkillsDir, "manual-plugin"));

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].installMethod).toBe("symlinked");
  });

  it("does NOT emit the legacy hardcoded 'symlinked' for plain cache directories", () => {
    // Pre-0769 every cache skill was tagged "symlinked" regardless of lstat.
    // Guard against regression of that behavior.
    writeCacheSkill(fakeHome, "mp-a", "plugin-a", "1.0.0", "skill-a");
    writeCacheSkill(fakeHome, "mp-b", "plugin-b", "2.0.0", "skill-b");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(2);
    for (const s of out) {
      expect(s.installMethod).toBe("copied");
    }
  });
});
