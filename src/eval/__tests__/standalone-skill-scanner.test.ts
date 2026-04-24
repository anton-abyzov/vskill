// ---------------------------------------------------------------------------
// 0698 T-003: standalone authoring scanner.
//
// Walks `<root>/skills/<skill>/SKILL.md` and emits SkillInfo entries tagged
// scope="own" (legacy) / scopeV2="authoring-project". EXCLUDES skills that
// live inside a plugin source (detected via a `.claude-plugin/plugin.json`
// ancestor) — those are handled by T-005's authored-plugin scanner.
// Cross-agent (no agentId gating; standalone authoring works for all agents).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanStandaloneSkills } from "../standalone-skill-scanner.js";

let tmpRoot: string;

function writeSkill(base: string, relDir: string, content = "# skill"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

function writeManifest(base: string, relDir: string, body: object = { name: "plg" }): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.json"), JSON.stringify(body));
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-t003-root-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("scanStandaloneSkills (0698 T-003)", () => {
  it("emits SkillInfo with scope='own'/scopeV2='authoring-project' for a top-level standalone skill", () => {
    writeSkill(tmpRoot, "skills/my-skill");
    const out = scanStandaloneSkills(tmpRoot);
    expect(out).toHaveLength(1);
    expect(out[0].skill).toBe("my-skill");
    expect(out[0].scope).toBe("own");
    expect(out[0].scopeV2).toBe("authoring-project");
    expect(out[0].group).toBe("authoring");
    expect(out[0].source).toBe("project");
  });

  it("skips skills inside plugin-source folders (ancestor has .claude-plugin/plugin.json)", () => {
    writeManifest(tmpRoot, "my-plugin/.claude-plugin");
    writeSkill(tmpRoot, "my-plugin/skills/foo");
    // Also plant a standalone skill so we prove filtering not global suppression
    writeSkill(tmpRoot, "skills/standalone-one");

    const out = scanStandaloneSkills(tmpRoot);
    const names = out.map((s) => s.skill);
    expect(names).toContain("standalone-one");
    expect(names).not.toContain("foo");
  });

  it("returns [] when <root>/skills/ is empty (no error)", () => {
    mkdirSync(join(tmpRoot, "skills"), { recursive: true });
    const out = scanStandaloneSkills(tmpRoot);
    expect(out).toEqual([]);
  });

  it("returns [] when <root>/skills/ does not exist (no error)", () => {
    const out = scanStandaloneSkills(tmpRoot);
    expect(out).toEqual([]);
  });

  it("only picks up top-level <root>/skills/<name>/SKILL.md — nested deeper paths are ignored", () => {
    writeSkill(tmpRoot, "skills/top-level");
    writeSkill(tmpRoot, "skills/deep/nested/inside");
    const out = scanStandaloneSkills(tmpRoot);
    const names = out.map((s) => s.skill);
    expect(names).toContain("top-level");
    expect(names).not.toContain("inside");
    // 'deep' itself is also not a valid skill (no SKILL.md directly inside)
    expect(names).not.toContain("deep");
  });

  it("is cross-agent: no agentId parameter, returns identical results regardless of caller", () => {
    writeSkill(tmpRoot, "skills/cross-agent-skill");
    const out = scanStandaloneSkills(tmpRoot);
    expect(out).toHaveLength(1);
    expect(out[0].skill).toBe("cross-agent-skill");
  });
});
