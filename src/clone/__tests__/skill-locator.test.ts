// ---------------------------------------------------------------------------
// Unit tests for src/clone/skill-locator.ts (T-011, AC-US1-01).
//
// Covers the three discovery locations (project / personal / cache),
// disambiguation when the same skill name exists in multiple places,
// namespace filtering, and the whole-plugin enumeration path.
//
// We use mkdtemp for fs isolation (the module already accepts `cwd` and
// `home` as injected options, which is the project's preferred shape — see
// src/commands/__tests__/check.test.ts for the same pattern).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  locateSkill,
  enumeratePluginSkills,
  parseSourceIdent,
} from "../skill-locator.js";

let tmpRoot: string;
let cwd: string;
let home: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-skill-locator-"));
  cwd = join(tmpRoot, "project");
  home = join(tmpRoot, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSkill(
  baseDir: string,
  skillName: string,
  frontmatter: string,
  body = "# body\n",
): string {
  const skillDir = join(baseDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\n${frontmatter}\n---\n\n${body}`);
  return skillDir;
}

function projectSkillsDir(): string {
  const dir = join(cwd, ".claude", "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function personalSkillsDir(): string {
  const dir = join(home, ".claude", "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function pluginCacheSkillsDir(
  org: string,
  pluginName: string,
  version: string,
): string {
  const dir = join(home, ".claude", "plugins", "cache", org, pluginName, version, "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------

describe("parseSourceIdent", () => {
  it("returns bare skill name when no slash is present", () => {
    expect(parseSourceIdent("ado-mapper")).toEqual({ skill: "ado-mapper" });
  });

  it("splits namespace and skill on first slash", () => {
    expect(parseSourceIdent("sw/ado-mapper")).toEqual({
      namespace: "sw",
      skill: "ado-mapper",
    });
  });
});

// ---------------------------------------------------------------------------

describe("locateSkill — single-location discovery", () => {
  it("finds a skill in the project location", async () => {
    writeSkill(projectSkillsDir(), "ado-mapper", "name: ado-mapper\nversion: 1.2.3");

    const matches = await locateSkill("ado-mapper", { cwd, home });

    expect(matches).toHaveLength(1);
    expect(matches[0].location).toBe("project");
    expect(matches[0].skillName).toBe("ado-mapper");
    expect(matches[0].version).toBe("1.2.3");
    expect(matches[0].plugin).toBeUndefined();
    expect(matches[0].existingProvenance).toBeNull();
  });

  it("finds a skill in the personal location", async () => {
    writeSkill(personalSkillsDir(), "ado-mapper", "name: sw/ado-mapper\nversion: 2.1.0");

    const matches = await locateSkill("ado-mapper", { cwd, home });

    expect(matches).toHaveLength(1);
    expect(matches[0].location).toBe("personal");
    expect(matches[0].skillName).toBe("sw/ado-mapper");
    expect(matches[0].namespace).toBe("sw");
    expect(matches[0].version).toBe("2.1.0");
  });

  it("finds a skill in the plugin cache and captures plugin context", async () => {
    const skillsDir = pluginCacheSkillsDir("sw", "spec-tools", "0.5.0");
    writeSkill(skillsDir, "ado-mapper", "name: sw/ado-mapper\nversion: 0.5.0");

    const matches = await locateSkill("ado-mapper", { cwd, home });

    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.location).toBe("cache");
    expect(m.skillName).toBe("sw/ado-mapper");
    expect(m.plugin).toEqual({
      pluginNamespace: "sw",
      pluginName: "spec-tools",
      pluginVersion: "0.5.0",
      pluginRoot: join(home, ".claude", "plugins", "cache", "sw", "spec-tools", "0.5.0"),
    });
  });

  it("returns an empty array when no source matches", async () => {
    const matches = await locateSkill("nonexistent", { cwd, home });
    expect(matches).toEqual([]);
  });

  it("falls back to directory basename when SKILL.md frontmatter omits name", async () => {
    writeSkill(projectSkillsDir(), "bare-skill", "version: 1.0.0");

    const matches = await locateSkill("bare-skill", { cwd, home });

    expect(matches).toHaveLength(1);
    expect(matches[0].skillName).toBe("bare-skill");
  });

  it("treats SKILL.md without a version as version 0.0.0", async () => {
    writeSkill(projectSkillsDir(), "no-ver", "name: no-ver");

    const matches = await locateSkill("no-ver", { cwd, home });

    expect(matches[0].version).toBe("0.0.0");
  });
});

// ---------------------------------------------------------------------------

describe("locateSkill — disambiguation across multiple locations", () => {
  it("returns matches in deterministic order: project, personal, cache", async () => {
    writeSkill(projectSkillsDir(), "shared", "name: shared\nversion: 1.0.0");
    writeSkill(personalSkillsDir(), "shared", "name: shared\nversion: 2.0.0");
    const cacheSkills = pluginCacheSkillsDir("acme", "tools", "0.0.1");
    writeSkill(cacheSkills, "shared", "name: acme/shared\nversion: 0.0.1");

    const matches = await locateSkill("shared", { cwd, home });

    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.location)).toEqual(["project", "personal", "cache"]);
  });

  it("filters cache matches by preferred namespace when source identifier includes one", async () => {
    const swCache = pluginCacheSkillsDir("sw", "plugin-a", "1.0.0");
    writeSkill(swCache, "ado-mapper", "name: sw/ado-mapper\nversion: 1.0.0");

    const otherCache = pluginCacheSkillsDir("anton", "plugin-b", "1.0.0");
    writeSkill(otherCache, "ado-mapper", "name: anton/ado-mapper\nversion: 1.0.0");

    const matches = await locateSkill("sw/ado-mapper", { cwd, home });

    expect(matches).toHaveLength(1);
    expect(matches[0].namespace).toBe("sw");
  });
});

// ---------------------------------------------------------------------------

describe("locateSkill — existing provenance pickup (chained-fork detection)", () => {
  it("captures existing .vskill-meta.json content for chained-fork detection", async () => {
    const dir = writeSkill(
      personalSkillsDir(),
      "already-forked",
      "name: anton/already-forked\nversion: 1.0.0",
    );
    const existingMeta = {
      promotedFrom: "installed",
      sourcePath: "/elsewhere",
      promotedAt: 0,
      forkedFrom: {
        source: "sw/already-forked",
        version: "0.9.0",
        clonedAt: "2026-01-01T00:00:00Z",
      },
    };
    writeFileSync(join(dir, ".vskill-meta.json"), JSON.stringify(existingMeta));

    const matches = await locateSkill("already-forked", { cwd, home });

    expect(matches).toHaveLength(1);
    expect(matches[0].existingProvenance).toEqual(existingMeta);
  });

  it("returns null existingProvenance when the sidecar is missing", async () => {
    writeSkill(projectSkillsDir(), "fresh", "name: fresh\nversion: 1.0.0");

    const matches = await locateSkill("fresh", { cwd, home });

    expect(matches[0].existingProvenance).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("enumeratePluginSkills", () => {
  it("returns every skill across every cached version of a plugin", async () => {
    const v1 = pluginCacheSkillsDir("sw", "spec-tools", "1.0.0");
    writeSkill(v1, "skill-a", "name: sw/skill-a\nversion: 1.0.0");
    writeSkill(v1, "skill-b", "name: sw/skill-b\nversion: 1.0.0");

    const v2 = pluginCacheSkillsDir("sw", "spec-tools", "1.1.0");
    writeSkill(v2, "skill-c", "name: sw/skill-c\nversion: 1.1.0");

    const results = await enumeratePluginSkills("spec-tools", { cwd, home });

    expect(results.map((r) => r.skillName).sort()).toEqual([
      "sw/skill-a",
      "sw/skill-b",
      "sw/skill-c",
    ]);
    for (const r of results) {
      expect(r.location).toBe("cache");
      expect(r.plugin?.pluginName).toBe("spec-tools");
    }
  });

  it("returns an empty array when the plugin is not in cache", async () => {
    const results = await enumeratePluginSkills("nonexistent", { cwd, home });
    expect(results).toEqual([]);
  });

  it("returns an empty array when the cache root itself is missing", async () => {
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });

    const results = await enumeratePluginSkills("anything", { cwd, home });
    expect(results).toEqual([]);
  });
});
