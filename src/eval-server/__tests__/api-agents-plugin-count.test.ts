// ---------------------------------------------------------------------------
// 0772 US-002 — buildAgentsResponse emits pluginSkillCount.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAgentsResponse,
  resetAgentPresenceCache,
} from "../api-routes.js";

let tmpRoot: string;
let fakeHome: string;

function writeSkill(base: string, relDir: string): string {
  const dir = join(base, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# skill\n");
  return dir;
}

function writePluginSkill(home: string, marketplace: string, plugin: string, version: string, skill: string): void {
  const dir = join(home, ".claude", "plugins", "cache", marketplace, plugin, version, "skills", skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# plugin skill\n");
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-plugin-count-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-plugin-count-home-"));
  resetAgentPresenceCache();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  resetAgentPresenceCache();
});

describe("buildAgentsResponse — pluginSkillCount (0772 US-002)", () => {
  it("AC-US2-01: claude-code entry has pluginSkillCount equal to scanned plugin skills", async () => {
    writeSkill(tmpRoot, ".claude/skills/local-a");
    writePluginSkill(fakeHome, "anthropic", "skill-creator", "1.0.0", "skill-a");
    writePluginSkill(fakeHome, "anthropic", "skill-creator", "1.0.0", "skill-b");
    writePluginSkill(fakeHome, "vskill-marketplace", "obsidian-brain", "0.1.0", "obsidian-brain");

    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    expect(claude).toBeDefined();
    expect(claude?.pluginSkillCount).toBe(3);
  });

  it("AC-US2-05: non-claude-code agents always have pluginSkillCount=0", async () => {
    writeSkill(tmpRoot, ".claude/skills/c1");
    writeSkill(fakeHome, ".cursor/skills/q1");
    writePluginSkill(fakeHome, "anthropic", "skill-creator", "1.0.0", "skill-x");

    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const cursor = resp.agents.find((a) => a.id === "cursor");
    expect(cursor?.pluginSkillCount).toBe(0);
    // Spot-check remote-only agents too
    const devin = resp.agents.find((a) => a.id === "devin");
    expect(devin?.pluginSkillCount).toBe(0);
  });

  it("returns pluginSkillCount=0 when no plugin cache directory exists", async () => {
    writeSkill(tmpRoot, ".claude/skills/local-a");
    // no plugins/cache subtree under fakeHome

    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    expect(claude?.pluginSkillCount).toBe(0);
  });
});
