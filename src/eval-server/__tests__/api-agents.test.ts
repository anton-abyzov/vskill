// ---------------------------------------------------------------------------
// 0686: /api/agents — per-agent counts + shared-folder grouping.
//
// Exercises `buildAgentsResponse()` directly against a tmpdir-style fixture.
// The handler is a thin wrapper; the response builder is the tested surface.
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
  writeFileSync(join(dir, "SKILL.md"), "# skill");
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "vskill-api-agents-root-"));
  fakeHome = mkdtempSync(join(tmpdir(), "vskill-api-agents-home-"));
  resetAgentPresenceCache();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
  resetAgentPresenceCache();
});

describe("buildAgentsResponse — presence + counts", () => {
  it("returns only agents with presence (local folder, global folder, or binary)", async () => {
    // .claude/ exists in project → claude-code detected
    writeSkill(tmpRoot, ".claude/skills/c1");
    // ~/.cursor/skills exists in fake home → cursor detected (via global)
    writeSkill(fakeHome, ".cursor/skills/q1");

    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });

    const ids = resp.agents.map((a) => a.id).sort();
    expect(ids).toContain("claude-code");
    expect(ids).toContain("cursor");
    // No other agent should appear — none of their paths exist
    expect(ids.filter((id) => id !== "claude-code" && id !== "cursor")).toEqual([]);
  });

  it("includes binary-detected agents even when no folders exist", async () => {
    const resp = await buildAgentsResponse({
      root: tmpRoot,
      home: fakeHome,
      detectedBinaries: new Set(["codex"]),
    });
    expect(resp.agents.map((a) => a.id)).toContain("codex");
  });

  it("reports accurate localSkillCount + globalSkillCount per agent", async () => {
    writeSkill(tmpRoot, ".claude/skills/local-a");
    writeSkill(tmpRoot, ".claude/skills/local-b");
    writeSkill(fakeHome, ".claude/skills/global-x");
    writeSkill(fakeHome, ".claude/skills/global-y");
    writeSkill(fakeHome, ".claude/skills/global-z");

    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    expect(claude?.localSkillCount).toBe(2);
    expect(claude?.globalSkillCount).toBe(3);
  });

  it("marks claude-code as default when the .claude/ folder exists", async () => {
    writeSkill(tmpRoot, ".claude/skills/x");
    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    expect(claude?.isDefault).toBe(true);
  });

  it("does not mark claude-code as default when .claude/ is absent", async () => {
    writeSkill(tmpRoot, ".cursor/skills/x");
    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    if (claude) {
      expect(claude.isDefault).toBe(false);
    }
  });

  it("returns resolvedLocalDir + resolvedGlobalDir as absolute, tilde-free paths", async () => {
    writeSkill(tmpRoot, ".claude/skills/a");
    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    const claude = resp.agents.find((a) => a.id === "claude-code");
    expect(claude?.resolvedLocalDir.startsWith(tmpRoot)).toBe(true);
    expect(claude?.resolvedGlobalDir).not.toContain("~");
  });

  it("suggested defaults to claude-code when detected", async () => {
    writeSkill(tmpRoot, ".claude/skills/a");
    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    expect(resp.suggested).toBe("claude-code");
  });

  it("suggested falls back to the alphabetically-first detected agent when claude-code is absent", async () => {
    writeSkill(fakeHome, ".cursor/skills/c");
    const resp = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    expect(resp.suggested).toBe("cursor");
  });
});

describe("buildAgentsResponse — shared folder grouping", () => {
  it("groups agents that resolve to the same globalSkillsDir into sharedFolders", async () => {
    // amp + kimi-cli + replit all point at ~/.config/agents/skills
    writeSkill(fakeHome, ".config/agents/skills/shared-x");

    const resp = await buildAgentsResponse({
      root: tmpRoot,
      home: fakeHome,
      detectedBinaries: new Set(["amp", "kimi-cli", "replit"]),
    });

    expect(resp.sharedFolders.length).toBeGreaterThanOrEqual(1);
    const shared = resp.sharedFolders.find((s) => s.consumers.includes("kimi-cli"));
    expect(shared).toBeDefined();
    expect(shared?.consumers.sort()).toEqual(["amp", "kimi-cli", "replit"].sort());
    expect(shared?.path).not.toContain("~");
  });

  it("does not emit sharedFolders entries for single-consumer folders", async () => {
    writeSkill(fakeHome, ".claude/skills/only-one");
    const resp = await buildAgentsResponse({
      root: tmpRoot,
      home: fakeHome,
      detectedBinaries: new Set(),
    });
    for (const s of resp.sharedFolders) {
      expect(s.consumers.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("buildAgentsResponse — detection cache (30s TTL)", () => {
  it("reuses cached presence within TTL window", async () => {
    writeSkill(tmpRoot, ".claude/skills/c1");
    const first = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });

    // Simulate a cached result — plant a new folder then call again WITHOUT
    // resetting the cache. The cached response should NOT reflect the new
    // folder because the cache hasn't expired.
    writeSkill(tmpRoot, ".cursor/skills/q1");
    const second = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });

    // cache hit — result is identical to first call
    expect(second.agents.map((a) => a.id).sort()).toEqual(first.agents.map((a) => a.id).sort());

    // After resetting cache, cursor appears
    resetAgentPresenceCache();
    const third = await buildAgentsResponse({ root: tmpRoot, home: fakeHome, detectedBinaries: new Set() });
    expect(third.agents.map((a) => a.id)).toContain("cursor");
  });
});
