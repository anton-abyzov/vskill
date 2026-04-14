// ---------------------------------------------------------------------------
// Tests for T-017: Graceful degradation when updates API fails
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SkillInfo } from "../types";

// Mock fetch globally
const originalFetch = globalThis.fetch;

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "test-plugin",
    skill: "test-skill",
    dir: "/tmp",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 5,
    assertionCount: 10,
    benchmarkStatus: "pass",
    lastBenchmark: null,
    origin: "source",
    ...overrides,
  };
}

describe("api.getSkillUpdates", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns update data on success", async () => {
    const updates = [
      { name: "owner/repo/skill", installed: "1.0.0", latest: "1.0.3", updateAvailable: true },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updates),
    }) as any;

    const { api } = await import("../api.js");
    const result = await api.getSkillUpdates();
    expect(result).toEqual(updates);
  });

  it("returns empty array on HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal Server Error" }),
      statusText: "Internal Server Error",
    }) as any;

    const { api } = await import("../api.js");
    const result = await api.getSkillUpdates();
    expect(result).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error")) as any;

    const { api } = await import("../api.js");
    const result = await api.getSkillUpdates();
    expect(result).toEqual([]);
  });
});

describe("mergeUpdatesIntoSkills", () => {
  it("merges update data into matching skills", async () => {
    const { mergeUpdatesIntoSkills } = await import("../api.js");

    const skills: SkillInfo[] = [
      makeSkill({ plugin: "owner-repo", skill: "architect" }),
      makeSkill({ plugin: "owner-repo", skill: "debug" }),
    ];

    const updates = [
      { name: "owner/repo/architect", installed: "1.0.0", latest: "1.0.3", updateAvailable: true },
    ];

    const merged = mergeUpdatesIntoSkills(skills, updates);

    expect(merged[0].updateAvailable).toBe(true);
    expect(merged[0].latestVersion).toBe("1.0.3");
    expect(merged[0].currentVersion).toBe("1.0.0");

    // debug not in updates — should remain unchanged
    expect(merged[1].updateAvailable).toBeUndefined();
  });

  it("returns skills unchanged when updates is empty", async () => {
    const { mergeUpdatesIntoSkills } = await import("../api.js");

    const skills: SkillInfo[] = [makeSkill()];
    const merged = mergeUpdatesIntoSkills(skills, []);

    expect(merged).toEqual(skills);
  });
});
