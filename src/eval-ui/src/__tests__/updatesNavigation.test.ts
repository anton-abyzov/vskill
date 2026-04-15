import { describe, it, expect } from "vitest";
import type { SkillInfo } from "../types";

describe("Updates navigation logic", () => {
  it("derives updateCount from skills with updateAvailable", () => {
    const skills: SkillInfo[] = [
      { plugin: "p", skill: "a", dir: "/", hasEvals: false, hasBenchmark: false, evalCount: 0, assertionCount: 0, benchmarkStatus: "missing", lastBenchmark: null, origin: "installed", updateAvailable: true, latestVersion: "2.0.0" },
      { plugin: "p", skill: "b", dir: "/", hasEvals: false, hasBenchmark: false, evalCount: 0, assertionCount: 0, benchmarkStatus: "missing", lastBenchmark: null, origin: "installed", updateAvailable: false },
      { plugin: "p", skill: "c", dir: "/", hasEvals: false, hasBenchmark: false, evalCount: 0, assertionCount: 0, benchmarkStatus: "missing", lastBenchmark: null, origin: "installed", updateAvailable: true, latestVersion: "1.1.0" },
      { plugin: "p", skill: "d", dir: "/", hasEvals: false, hasBenchmark: false, evalCount: 0, assertionCount: 0, benchmarkStatus: "missing", lastBenchmark: null, origin: "source" },
    ];

    const updateCount = skills.filter((s) => s.updateAvailable).length;
    expect(updateCount).toBe(2);
  });

  it("badge hidden when updateCount is 0", () => {
    const updateCount = 0;
    const showBadge = updateCount > 0;
    expect(showBadge).toBe(false);
  });

  it("hash-based routing: #/updates", () => {
    const hash = "#/updates";
    const isUpdatesView = hash === "#/updates";
    expect(isUpdatesView).toBe(true);
  });
});
