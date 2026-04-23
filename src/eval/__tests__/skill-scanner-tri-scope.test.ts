// ---------------------------------------------------------------------------
// 0686 T-003: tri-scope skill scanner — own | installed | global.
//
// Exercises scanSkillsTriScope() with a fixture that plants:
//   - own skills      under   <cwd>/myplugin/skills/<skill>/
//   - installed skills under   <cwd>/.claude/skills/<skill>/
//   - global skills   under   <fakeHome>/.claude/skills/<skill>/
//
// `fakeHome` is injected through the options arg so we don't have to poke
// HOME / USERPROFILE at the process level (which breaks in parallel tests).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanSkillsTriScope } from "../skill-scanner.js";

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string, content = "# skill"): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), content);
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-triscope-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-triscope-home-"));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("scanSkillsTriScope — three scopes partitioned by location", () => {
  it("returns OWN + INSTALLED + GLOBAL skills each tagged with scope", async () => {
    writeSkill(tmpRoot, "myplugin/skills/own-skill");
    writeSkill(tmpRoot, ".claude/skills/installed-skill");
    writeSkill(fakeHome, ".claude/skills/global-skill");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });

    const byName = Object.fromEntries(skills.map((s) => [s.skill, s]));
    expect(byName["own-skill"]?.scope).toBe("own");
    expect(byName["installed-skill"]?.scope).toBe("installed");
    expect(byName["global-skill"]?.scope).toBe("global");
  });

  it("tags each SkillInfo with installMethod matching scope", async () => {
    writeSkill(tmpRoot, "myplugin/skills/authored-skill");
    writeSkill(tmpRoot, ".claude/skills/copied-skill");
    writeSkill(fakeHome, ".claude/skills/global-copied-skill");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });

    const own = skills.find((s) => s.skill === "authored-skill");
    const installed = skills.find((s) => s.skill === "copied-skill");
    const global = skills.find((s) => s.skill === "global-copied-skill");

    expect(own?.installMethod).toBe("authored");
    expect(installed?.installMethod).toBe("copied");
    expect(global?.installMethod).toBe("copied");
  });

  it("populates sourceAgent for installed/global, null for own", async () => {
    writeSkill(tmpRoot, "myplugin/skills/own-one");
    writeSkill(tmpRoot, ".claude/skills/installed-one");
    writeSkill(fakeHome, ".claude/skills/global-one");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });

    expect(skills.find((s) => s.skill === "own-one")?.sourceAgent).toBeNull();
    expect(skills.find((s) => s.skill === "installed-one")?.sourceAgent).toBe("claude-code");
    expect(skills.find((s) => s.skill === "global-one")?.sourceAgent).toBe("claude-code");
  });

  it("backward-compat: `origin` remains populated for every skill (source|installed)", async () => {
    writeSkill(tmpRoot, "myplugin/skills/own-back");
    writeSkill(tmpRoot, ".claude/skills/installed-back");
    writeSkill(fakeHome, ".claude/skills/global-back");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });

    for (const s of skills) {
      expect(s.origin === "source" || s.origin === "installed").toBe(true);
    }
    expect(skills.find((s) => s.skill === "own-back")?.origin).toBe("source");
    expect(skills.find((s) => s.skill === "installed-back")?.origin).toBe("installed");
    expect(skills.find((s) => s.skill === "global-back")?.origin).toBe("installed");
  });

  it("returns empty array when neither the cwd nor the global home has skills", async () => {
    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });
    expect(skills).toEqual([]);
  });

  it("when agentId is unknown, global scope yields no skills", async () => {
    writeSkill(tmpRoot, "myplugin/skills/own-x");
    writeSkill(fakeHome, ".claude/skills/global-x");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "not-a-real-agent",
      home: fakeHome,
    });

    expect(skills.some((s) => s.scope === "global")).toBe(false);
    expect(skills.some((s) => s.scope === "own")).toBe(true);
  });

  it("non-active-agent local wrappers are still tagged installed (sourceAgent carries the owning agent)", async () => {
    // cursor is the active agent, but .claude/skills still resolves as an
    // agent-installed scope (origin=installed), just tagged with its owning
    // agent so the UI can filter by sourceAgent.
    writeSkill(tmpRoot, ".claude/skills/foreign-installed");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "cursor",
      home: fakeHome,
    });

    const s = skills.find((x) => x.skill === "foreign-installed");
    expect(s?.scope).toBe("installed");
    expect(s?.sourceAgent).toBe("claude-code");
  });

  it("dir fields are absolute paths with no tilde literal", async () => {
    writeSkill(tmpRoot, "myplugin/skills/p1");
    writeSkill(tmpRoot, ".claude/skills/p2");
    writeSkill(fakeHome, ".claude/skills/p3");

    const skills = await scanSkillsTriScope(tmpRoot, {
      agentId: "claude-code",
      home: fakeHome,
    });

    for (const s of skills) {
      expect(s.dir).not.toContain("~");
      // Each dir starts with either tmpRoot or fakeHome (both absolute).
      const root = s.scope === "global" ? fakeHome : tmpRoot;
      expect(s.dir.startsWith(root)).toBe(true);
    }
  });
});
