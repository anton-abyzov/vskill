// ---------------------------------------------------------------------------
// 0759 Phase 6 — getDirtySkillIds tests.
//
// Pure resolver: given a list of skills (with absolute `dir` paths) and a
// flat list of dirty file paths (relative to the workspace root, as emitted
// by `git status --porcelain`), return the set of skill IDs ("plugin/skill")
// whose directory contains at least one dirty path.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getDirtySkillIds } from "../getDirtySkillIds";
import type { SkillInfo } from "../../types";

function mkSkill(plugin: string, skill: string, dir: string): SkillInfo {
  // We only care about the fields the resolver reads. Cast through unknown to
  // satisfy the broad SkillInfo shape without hand-filling 30+ fields.
  return { plugin, skill, dir, origin: "source" } as unknown as SkillInfo;
}

describe("getDirtySkillIds", () => {
  it("returns the IDs of skills whose directory contains a dirty path (relative paths under workspace root)", () => {
    const root = "/work/repo";
    const skills = [
      mkSkill("p1", "alpha", "/work/repo/p1/skills/alpha"),
      mkSkill("p1", "beta", "/work/repo/p1/skills/beta"),
      mkSkill("p2", "gamma", "/work/repo/p2/skills/gamma"),
    ];
    const dirty = [
      "p1/skills/alpha/SKILL.md",
      "p1/skills/alpha/notes.md",
      "p2/skills/gamma/scripts/foo.sh",
      "README.md", // outside any skill — should not match anything
    ];
    const result = getDirtySkillIds(skills, dirty, root);
    expect(Array.from(result).sort()).toEqual(["p1/alpha", "p2/gamma"]);
  });

  it("returns empty set when no dirty paths intersect any skill dir", () => {
    const skills = [mkSkill("p", "a", "/r/p/skills/a")];
    expect(getDirtySkillIds(skills, ["other.txt"], "/r").size).toBe(0);
  });

  it("returns empty set when dirty list is empty", () => {
    const skills = [mkSkill("p", "a", "/r/p/skills/a")];
    expect(getDirtySkillIds(skills, [], "/r").size).toBe(0);
  });

  it("handles a skill whose dir IS the workspace root (any dirty path → dirty)", () => {
    const root = "/r";
    const skills = [mkSkill("anton", "greet-anton", "/r")];
    const dirty = ["SKILL.md", "NOTES.md"];
    expect(Array.from(getDirtySkillIds(skills, dirty, root))).toEqual(["anton/greet-anton"]);
  });

  it("does not match a skill whose dir is a sibling prefix substring (foo vs foobar)", () => {
    const root = "/r";
    const skills = [
      mkSkill("p", "foo", "/r/skills/foo"),
      mkSkill("p", "foobar", "/r/skills/foobar"),
    ];
    const dirty = ["skills/foobar/SKILL.md"];
    const result = getDirtySkillIds(skills, dirty, root);
    expect(Array.from(result)).toEqual(["p/foobar"]);
    expect(result.has("p/foo")).toBe(false);
  });

  it("ignores skills whose dir is OUTSIDE the workspace root (defensive — shouldn't happen but safe)", () => {
    const root = "/r";
    const skills = [mkSkill("p", "outside", "/somewhere/else/skills/outside")];
    const dirty = ["skills/outside/SKILL.md"];
    expect(getDirtySkillIds(skills, dirty, root).size).toBe(0);
  });

  it("trims porcelain status prefix when present (e.g. ' M ' / '?? ')", () => {
    // Some callers may forward raw porcelain lines without parsing. The
    // resolver tolerates an optional 3-char status prefix for robustness.
    const root = "/r";
    const skills = [mkSkill("p", "a", "/r/p/skills/a")];
    const dirty = [" M p/skills/a/SKILL.md", "?? p/skills/a/notes.md"];
    expect(Array.from(getDirtySkillIds(skills, dirty, root))).toEqual(["p/a"]);
  });

  it("normalises skill IDs as `<plugin>/<skill>`", () => {
    const skills = [mkSkill("my-plugin", "my-skill", "/r/my-plugin/skills/my-skill")];
    const dirty = ["my-plugin/skills/my-skill/SKILL.md"];
    const ids = Array.from(getDirtySkillIds(skills, dirty, "/r"));
    expect(ids).toEqual(["my-plugin/my-skill"]);
  });
});
