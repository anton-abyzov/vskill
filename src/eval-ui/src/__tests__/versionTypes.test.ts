import { describe, it, expect } from "vitest";
import type { SkillInfo, VersionEntry, VersionDiff, VersionDetail, BatchUpdateProgress } from "../types";

describe("Version lifecycle types", () => {
  it("SkillInfo accepts pinnedVersion field", () => {
    const info: SkillInfo = {
      plugin: "test",
      skill: "demo",
      dir: "/tmp",
      hasEvals: true,
      hasBenchmark: false,
      evalCount: 3,
      assertionCount: 5,
      benchmarkStatus: "pass",
      lastBenchmark: null,
      origin: "installed",
      pinnedVersion: "1.0.0",
    };
    expect(info.pinnedVersion).toBe("1.0.0");
  });

  it("SkillInfo compiles without pinnedVersion (backward compat)", () => {
    const info: SkillInfo = {
      plugin: "test",
      skill: "demo",
      dir: "/tmp",
      hasEvals: false,
      hasBenchmark: false,
      evalCount: 0,
      assertionCount: 0,
      benchmarkStatus: "missing",
      lastBenchmark: null,
      origin: "source",
    };
    expect(info.pinnedVersion).toBeUndefined();
  });

  it("VersionEntry has correct shape", () => {
    const entry: VersionEntry = {
      version: "2.3.0",
      certTier: "CERTIFIED",
      certScore: 95,
      diffSummary: "Added multi-repo support",
      createdAt: "2026-04-10T00:00:00Z",
      isInstalled: true,
    };
    expect(entry.version).toBe("2.3.0");
    expect(entry.isInstalled).toBe(true);
    expect(entry.certScore).toBe(95);
  });

  it("VersionEntry works without optional fields", () => {
    const entry: VersionEntry = {
      version: "1.0.0",
      certTier: "COMMUNITY",
      diffSummary: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(entry.certScore).toBeUndefined();
    expect(entry.isInstalled).toBeUndefined();
  });

  it("VersionDiff has correct shape", () => {
    const diff: VersionDiff = {
      from: "1.0.0",
      to: "2.0.0",
      diffSummary: "Major rewrite",
      contentDiff: "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -1 +1 @@\n-old\n+new",
    };
    expect(diff.from).toBe("1.0.0");
    expect(diff.contentDiff).toContain("---");
  });

  it("VersionDetail has correct shape", () => {
    const detail: VersionDetail = {
      version: "1.0.0",
      content: "# Skill\nBody content here",
      certTier: "VERIFIED",
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(detail.content).toContain("# Skill");
    expect(detail.certScore).toBeUndefined();
  });

  it("BatchUpdateProgress covers all status values", () => {
    const statuses: BatchUpdateProgress["status"][] = [
      "pending", "updating", "scanning", "installing", "done", "error", "skipped",
    ];
    for (const status of statuses) {
      const progress: BatchUpdateProgress = { skill: "architect", status };
      expect(progress.status).toBe(status);
    }
  });

  it("BatchUpdateProgress accepts optional fields", () => {
    const progress: BatchUpdateProgress = {
      skill: "architect",
      status: "done",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      scanScore: 95,
      scanVerdict: "PASS",
    };
    expect(progress.fromVersion).toBe("1.0.0");
    expect(progress.scanScore).toBe(95);
  });

  it("BatchUpdateProgress accepts error field", () => {
    const progress: BatchUpdateProgress = {
      skill: "architect",
      status: "error",
      error: "Network timeout",
    };
    expect(progress.error).toBe("Network timeout");
  });
});
