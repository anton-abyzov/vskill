// ---------------------------------------------------------------------------
// 0740 T-011 — mergeUpdatesIntoSkills: gate by origin + match by full identity
// ---------------------------------------------------------------------------
// Bug: matching by `s.skill === u.shortName` propagates the ↑ glyph to every
// row sharing a leaf name (e.g. all four `obsidian-brain` rows in the
// sidebar). Authoring rows that are NOT the lockfile-tracked install were
// receiving false update signals.
//
// Fix: only merge into rows with `origin === "installed"`, and prefer matches
// keyed by `<pluginName>/<skill>` over bare `<skill>`.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { mergeUpdatesIntoSkills } from "../api";
import type { SkillInfo, SkillUpdateInfo } from "../api";

function row(over: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: "personal",
    skill: "obsidian-brain",
    dir: "/some/path/obsidian-brain",
    hasEvals: false,
    hasBenchmark: false,
    origin: "source",
    ...over,
  } as SkillInfo;
}

function update(over: Partial<SkillUpdateInfo>): SkillUpdateInfo {
  return {
    name: "anton-abyzov/vskill/obsidian-brain",
    installed: "1.0.0",
    latest: "1.0.6",
    updateAvailable: true,
    ...over,
  } as SkillUpdateInfo;
}

describe("0740 mergeUpdatesIntoSkills — origin gating + identity match", () => {
  it("does NOT merge update onto authoring (own) rows even when leaf name matches", () => {
    const skills = [
      row({ origin: "source", scopeV2: "authoring-project" as never }),
      row({ origin: "source", scopeV2: "authoring-plugin" as never, dir: "/p2/obsidian-brain" }),
    ];
    const out = mergeUpdatesIntoSkills(skills, [update({})]);
    for (const s of out) {
      expect(s.updateAvailable).toBeFalsy();
      expect(s.currentVersion).toBeUndefined();
    }
  });

  it("merges update onto installed row only", () => {
    const skills = [
      row({ origin: "source", dir: "/authored/obsidian-brain" }), // authored
      row({ origin: "installed", dir: "/installed/obsidian-brain" }), // installed
    ];
    const out = mergeUpdatesIntoSkills(skills, [update({})]);
    const authored = out.find((s) => s.dir === "/authored/obsidian-brain")!;
    const installed = out.find((s) => s.dir === "/installed/obsidian-brain")!;
    expect(authored.updateAvailable).toBeFalsy();
    expect(installed.updateAvailable).toBe(true);
    expect(installed.currentVersion).toBe("1.0.0");
    expect(installed.latestVersion).toBe("1.0.6");
  });

  it("matches on `pluginName/skill` when SkillUpdateInfo carries a plugin scope", () => {
    // Two installed rows with the same leaf `skill`, different pluginNames.
    // The update is for the `vskill`-sourced one only — only that one merges.
    const skills = [
      row({
        origin: "installed",
        plugin: "vskill",
        pluginName: "vskill",
        dir: "/installed/vskill/obsidian-brain",
      }),
      row({
        origin: "installed",
        plugin: "other-plugin",
        pluginName: "other-plugin",
        dir: "/installed/other/obsidian-brain",
      }),
    ];
    const out = mergeUpdatesIntoSkills(skills, [
      update({ name: "anton-abyzov/vskill/obsidian-brain" }),
    ]);
    const vs = out.find((s) => s.pluginName === "vskill")!;
    const other = out.find((s) => s.pluginName === "other-plugin")!;
    expect(vs.updateAvailable).toBe(true);
    expect(other.updateAvailable).toBeFalsy();
  });

  it("falls back to leaf-name match when SkillUpdateInfo.name is bare leaf", () => {
    const skills = [
      row({ origin: "installed", dir: "/installed/foo", skill: "foo" }),
    ];
    const out = mergeUpdatesIntoSkills(skills, [update({ name: "foo" })]);
    expect(out[0].updateAvailable).toBe(true);
  });

  it("returns empty-update input as identity (no mutation)", () => {
    const skills = [row({ origin: "installed" })];
    const out = mergeUpdatesIntoSkills(skills, []);
    expect(out).toBe(skills); // exact same reference
  });
});
