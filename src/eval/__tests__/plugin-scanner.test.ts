// ---------------------------------------------------------------------------
// 0698 T-004/T-005: plugin scanners.
//
// T-004: scanInstalledPluginSkills — walks
//        <home>/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/
//        and emits scope="available-plugin". Claude Code only.
//
// T-005: scanAuthoredPluginSkills — walks a project for
//        **/.claude-plugin/plugin.json + sibling skills/<skill>/SKILL.md and
//        emits scope="authoring-plugin". Claude Code only. Excludes node_modules.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanInstalledPluginSkills,
  scanAuthoredPluginSkills,
} from "../plugin-scanner.js";

let fakeHome: string;
let tmpRoot: string;

function writeSkill(base: string, relDir: string, content = "# skill"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

function writePluginManifest(base: string, relDir: string, body: object = { name: "plg" }): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(body));
  return dir;
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-t004-home-"));
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-t004-root-"));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("scanInstalledPluginSkills (0698 T-004)", () => {
  it("emits SkillInfo with correct scope + plugin metadata for CC", () => {
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/increment");
    writePluginManifest(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/.claude-plugin", { name: "sw" });

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(s.skill).toBe("increment");
    expect(s.scope).toBe("installed");
    expect(s.scopeV2).toBe("available-plugin");
    expect(s.group).toBe("available");
    expect(s.source).toBe("plugin");
    expect(s.pluginName).toBe("sw");
    expect(s.pluginMarketplace).toBe("specweave");
    expect(s.pluginVersion).toBe("1.0.0");
    expect(s.pluginNamespace).toBe("sw:increment");
    expect(s.precedenceRank).toBe(-1);
  });

  it("returns [] for non-Claude-Code agents", () => {
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/increment");
    expect(scanInstalledPluginSkills({ agentId: "cursor", home: fakeHome })).toEqual([]);
    expect(scanInstalledPluginSkills({ agentId: "windsurf", home: fakeHome })).toEqual([]);
  });

  it("picks highest semver when a plugin has multiple versions", () => {
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/increment");
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.1.0/skills/increment");
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.5/skills/increment");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].pluginVersion).toBe("1.1.0");
  });

  it("groups across multiple marketplaces and plugins", () => {
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/increment");
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/do");
    writeSkill(fakeHome, ".claude/plugins/cache/anthropic-skills/pdf-plugin/1.0.0/skills/pdf");

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(3);
    const marketplaces = new Set(out.map((s) => s.pluginMarketplace));
    expect(marketplaces).toEqual(new Set(["specweave", "anthropic-skills"]));
    const names = new Set(out.map((s) => s.pluginNamespace));
    expect(names).toEqual(new Set(["sw:increment", "sw:do", "pdf-plugin:pdf"]));
  });

  it("returns [] when ~/.claude/plugins/cache does not exist (no throw)", () => {
    // fakeHome is empty — no cache dir
    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toEqual([]);
  });

  it("emits skills even when plugin.json is absent", () => {
    writeSkill(fakeHome, ".claude/plugins/cache/specweave/sw/1.0.0/skills/increment");
    // no .claude-plugin/plugin.json written

    const out = scanInstalledPluginSkills({ agentId: "claude-code", home: fakeHome });
    expect(out).toHaveLength(1);
    expect(out[0].pluginName).toBe("sw");
  });
});

describe("scanAuthoredPluginSkills (0698 T-005)", () => {
  it("emits SkillInfo with scope='authoring-plugin' and manifest path for CC", () => {
    writePluginManifest(tmpRoot, "my-plugin/.claude-plugin", { name: "my-plugin" });
    writeSkill(tmpRoot, "my-plugin/skills/greeter");
    writeSkill(tmpRoot, "my-plugin/skills/cleanup");

    const out = scanAuthoredPluginSkills({ agentId: "claude-code", projectRoot: tmpRoot });
    expect(out).toHaveLength(2);
    const skills = out.map((s) => s.skill).sort();
    expect(skills).toEqual(["cleanup", "greeter"]);
    for (const s of out) {
      expect(s.scopeV2).toBe("authoring-plugin");
      expect(s.group).toBe("authoring");
      expect(s.source).toBe("plugin");
      expect(s.pluginName).toBe("my-plugin");
      expect(s.pluginManifestPath).toContain("my-plugin/.claude-plugin/plugin.json");
    }
  });

  it("returns [] for non-Claude-Code agents", () => {
    writePluginManifest(tmpRoot, "my-plugin/.claude-plugin");
    writeSkill(tmpRoot, "my-plugin/skills/foo");
    expect(scanAuthoredPluginSkills({ agentId: "cursor", projectRoot: tmpRoot })).toEqual([]);
  });

  it("excludes plugins vendored in node_modules", () => {
    writePluginManifest(tmpRoot, "node_modules/vendored-plugin/.claude-plugin");
    writeSkill(tmpRoot, "node_modules/vendored-plugin/skills/foo");
    const out = scanAuthoredPluginSkills({ agentId: "claude-code", projectRoot: tmpRoot });
    expect(out).toEqual([]);
  });

  it("respects default depth cap of 4 for manifest discovery", () => {
    // plugin at depth 5: <root>/a/b/c/d/my-plugin/.claude-plugin/plugin.json
    writePluginManifest(tmpRoot, "a/b/c/d/my-plugin/.claude-plugin");
    writeSkill(tmpRoot, "a/b/c/d/my-plugin/skills/foo");
    const out = scanAuthoredPluginSkills({ agentId: "claude-code", projectRoot: tmpRoot });
    expect(out).toEqual([]);
  });

  it("emits nothing (no throw) when plugin source has no sibling skills/ directory", () => {
    writePluginManifest(tmpRoot, "my-plugin/.claude-plugin");
    // no skills/ dir
    const out = scanAuthoredPluginSkills({ agentId: "claude-code", projectRoot: tmpRoot });
    expect(out).toEqual([]);
  });
});
