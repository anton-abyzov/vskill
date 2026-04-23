// ---------------------------------------------------------------------------
// 0686: /api/skills?scope=&agent= filter coverage.
//
// Tests the exported `filterSkillsByScopeAndAgent` helper that backs the
// query-string extension of /api/skills. Ordering + field preservation are
// asserted via a tmpdir-style fixture feeding scanSkillsTriScope.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillsTriScope } from "../../eval/skill-scanner.js";
import { filterSkillsByScopeAndAgent } from "../api-routes.js";

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# skill");
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-api-scope-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-api-scope-home-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

async function seededSkills() {
  writeSkill(tmpRoot, "myplugin/skills/own-a");
  writeSkill(tmpRoot, "myplugin/skills/own-b");
  writeSkill(tmpRoot, ".claude/skills/installed-cc");
  writeSkill(tmpRoot, ".cursor/skills/installed-cur");
  writeSkill(fakeHome, ".claude/skills/global-cc");
  return scanSkillsTriScope(tmpRoot, { agentId: "claude-code", home: fakeHome });
}

describe("filterSkillsByScopeAndAgent — defaults", () => {
  it("with no filters, returns all skills unchanged", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, {});
    expect(filtered.length).toBe(all.length);
    expect(filtered.map((s) => s.skill).sort()).toEqual(
      all.map((s) => s.skill).sort(),
    );
  });
});

describe("filterSkillsByScopeAndAgent — scope filter", () => {
  it("scope='own' returns only own-scope skills", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { scope: "own" });
    expect(filtered.map((s) => s.skill).sort()).toEqual(["own-a", "own-b"]);
    for (const s of filtered) expect(s.scope).toBe("own");
  });

  it("scope='installed' returns only installed-scope skills", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { scope: "installed" });
    const names = filtered.map((s) => s.skill).sort();
    expect(names).toContain("installed-cc");
    expect(names).toContain("installed-cur");
    for (const s of filtered) expect(s.scope).toBe("installed");
  });

  it("scope='global' returns only global-scope skills", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { scope: "global" });
    expect(filtered.map((s) => s.skill)).toEqual(["global-cc"]);
    for (const s of filtered) expect(s.scope).toBe("global");
  });

  it("unknown scope returns empty array", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { scope: "mystery" });
    expect(filtered).toEqual([]);
  });
});

describe("filterSkillsByScopeAndAgent — agent filter", () => {
  it("agent='claude-code' returns own + claude-code-owned skills", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { agent: "claude-code" });
    const names = filtered.map((s) => s.skill).sort();
    expect(names).toContain("own-a");
    expect(names).toContain("installed-cc");
    expect(names).toContain("global-cc");
    expect(names).not.toContain("installed-cur");
  });

  it("agent='cursor' excludes skills owned by other agents", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, { agent: "cursor" });
    const names = filtered.map((s) => s.skill).sort();
    expect(names).toContain("installed-cur");
    expect(names).not.toContain("installed-cc");
    expect(names).not.toContain("global-cc");
  });
});

describe("filterSkillsByScopeAndAgent — combined scope + agent", () => {
  it("scope='installed' + agent='claude-code' returns only the matching intersection", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, {
      scope: "installed",
      agent: "claude-code",
    });
    const names = filtered.map((s) => s.skill);
    expect(names).toEqual(["installed-cc"]);
  });

  it("scope='global' + agent='claude-code' returns only the global claude-code skill", async () => {
    const all = await seededSkills();
    const filtered = filterSkillsByScopeAndAgent(all, {
      scope: "global",
      agent: "claude-code",
    });
    expect(filtered.map((s) => s.skill)).toEqual(["global-cc"]);
  });
});
