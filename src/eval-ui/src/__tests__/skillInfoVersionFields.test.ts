// ---------------------------------------------------------------------------
// Type test: SkillInfo version fields are optional and backward compatible
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { SkillInfo } from "../types";

describe("SkillInfo version fields", () => {
  const base: SkillInfo = {
    plugin: "test",
    skill: "demo",
    dir: "/tmp",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 3,
    assertionCount: 5,
    benchmarkStatus: "pass",
    lastBenchmark: null,
    origin: "source",
  };

  it("compiles without version fields (backward compat)", () => {
    // If this test compiles and runs, the fields are optional
    expect(base.plugin).toBe("test");
    expect(base.updateAvailable).toBeUndefined();
    expect(base.currentVersion).toBeUndefined();
    expect(base.latestVersion).toBeUndefined();
  });

  it("accepts version fields when provided", () => {
    const withVersion: SkillInfo = {
      ...base,
      updateAvailable: true,
      currentVersion: "1.0.0",
      latestVersion: "1.0.3",
    };
    expect(withVersion.updateAvailable).toBe(true);
    expect(withVersion.currentVersion).toBe("1.0.0");
    expect(withVersion.latestVersion).toBe("1.0.3");
  });

  it("accepts false for updateAvailable", () => {
    const noUpdate: SkillInfo = { ...base, updateAvailable: false };
    expect(noUpdate.updateAvailable).toBe(false);
  });
});
