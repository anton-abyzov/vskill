import { describe, it, expect } from "vitest";
import type { SkillLockEntry, VskillLock } from "./types.js";
import { migrateLockEntry, migrateLock } from "./migration.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SkillLockEntry> = {}): SkillLockEntry {
  return {
    version: "1.0.0",
    sha: "abc123",
    tier: "VERIFIED",
    installedAt: "2026-01-01T00:00:00.000Z",
    source: "registry",
    ...overrides,
  };
}

function makeLock(overrides: Partial<VskillLock> = {}): VskillLock {
  return {
    version: 1,
    agents: [],
    skills: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// migrateLockEntry
// ---------------------------------------------------------------------------
describe("migrateLockEntry", () => {
  it("migrates empty version string to 1.0.0", () => {
    const entry = makeEntry({ version: "" });
    const result = migrateLockEntry(entry);
    expect(result.version).toBe("1.0.0");
  });

  it("migrates 0.0.0 version to 1.0.0", () => {
    const entry = makeEntry({ version: "0.0.0" });
    const result = migrateLockEntry(entry);
    expect(result.version).toBe("1.0.0");
  });

  it("preserves valid version 2.3.1", () => {
    const entry = makeEntry({ version: "2.3.1" });
    const result = migrateLockEntry(entry);
    expect(result.version).toBe("2.3.1");
  });

  it("keeps missing files field as undefined", () => {
    const entry = makeEntry();
    const result = migrateLockEntry(entry);
    expect(result.files).toBeUndefined();
  });

  it("preserves existing files field", () => {
    const entry = makeEntry({ files: ["SKILL.md", "agents/a.md"] });
    const result = migrateLockEntry(entry);
    expect(result.files).toEqual(["SKILL.md", "agents/a.md"]);
  });

  it("returns a new object without mutating input", () => {
    const entry = makeEntry({ version: "" });
    const result = migrateLockEntry(entry);
    expect(result).not.toBe(entry);
    expect(entry.version).toBe("");
  });
});

// ---------------------------------------------------------------------------
// migrateLock
// ---------------------------------------------------------------------------
describe("migrateLock", () => {
  it("applies migrateLockEntry to all entries", () => {
    const lock = makeLock({
      skills: {
        "skill-a": makeEntry({ version: "" }),
        "skill-b": makeEntry({ version: "0.0.0" }),
        "skill-c": makeEntry({ version: "3.0.0" }),
      },
    });

    const result = migrateLock(lock);

    expect(result.skills["skill-a"].version).toBe("1.0.0");
    expect(result.skills["skill-b"].version).toBe("1.0.0");
    expect(result.skills["skill-c"].version).toBe("3.0.0");
  });

  it("returns a new VskillLock without mutating input", () => {
    const lock = makeLock({
      skills: { "s1": makeEntry({ version: "0.0.0" }) },
    });

    const result = migrateLock(lock);

    expect(result).not.toBe(lock);
    expect(result.skills).not.toBe(lock.skills);
    expect(lock.skills["s1"].version).toBe("0.0.0");
  });
});
