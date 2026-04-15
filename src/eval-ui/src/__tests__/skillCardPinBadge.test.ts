import { describe, it, expect } from "vitest";
import type { SkillInfo } from "../types";

describe("SkillCard pin badge logic", () => {
  it("shows pin badge when pinnedVersion is set", () => {
    const skill: SkillInfo = {
      plugin: "test",
      skill: "architect",
      dir: "/tmp",
      hasEvals: true,
      hasBenchmark: false,
      evalCount: 3,
      assertionCount: 5,
      benchmarkStatus: "pass",
      lastBenchmark: null,
      origin: "installed",
      pinnedVersion: "1.0.0",
      updateAvailable: true,
      latestVersion: "2.0.0",
    };
    const showPinBadge = !!skill.pinnedVersion;
    expect(showPinBadge).toBe(true);
  });

  it("no pin badge when pinnedVersion is undefined", () => {
    const skill: SkillInfo = {
      plugin: "test",
      skill: "architect",
      dir: "/tmp",
      hasEvals: true,
      hasBenchmark: false,
      evalCount: 3,
      assertionCount: 5,
      benchmarkStatus: "pass",
      lastBenchmark: null,
      origin: "installed",
      updateAvailable: true,
      latestVersion: "2.0.0",
    };
    const showPinBadge = !!skill.pinnedVersion;
    expect(showPinBadge).toBe(false);
  });

  it("pin badge coexists with update badge", () => {
    const skill: SkillInfo = {
      plugin: "test",
      skill: "architect",
      dir: "/tmp",
      hasEvals: false,
      hasBenchmark: false,
      evalCount: 0,
      assertionCount: 0,
      benchmarkStatus: "missing",
      lastBenchmark: null,
      origin: "installed",
      pinnedVersion: "1.0.0",
      updateAvailable: true,
      latestVersion: "2.0.0",
    };
    const showPinBadge = !!skill.pinnedVersion;
    const showUpdateBadge = skill.updateAvailable && !!skill.latestVersion;
    expect(showPinBadge).toBe(true);
    expect(showUpdateBadge).toBe(true);
  });
});
