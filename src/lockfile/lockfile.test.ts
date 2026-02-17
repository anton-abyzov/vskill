import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VskillLock, SkillLockEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// Import after mock is set up
const {
  readLockfile,
  writeLockfile,
  ensureLockfile,
  addSkillToLock,
  removeSkillFromLock,
} = await import("./lockfile.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TEST_DIR = "/tmp/test-project";
const LOCK_PATH = `${TEST_DIR}/vskill.lock`;

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

function makeEntry(overrides: Partial<SkillLockEntry> = {}): SkillLockEntry {
  return {
    version: "1.0.0",
    sha: "abc123",
    tier: "SCANNED",
    installedAt: "2026-01-01T00:00:00.000Z",
    source: "registry",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-17T12:00:00.000Z"));
});

describe("readLockfile", () => {
  it("returns null when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const result = readLockfile(TEST_DIR);

    expect(result).toBeNull();
    expect(mockExistsSync).toHaveBeenCalledWith(LOCK_PATH);
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it("returns null on invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json {{{");

    const result = readLockfile(TEST_DIR);

    expect(result).toBeNull();
  });

  it("parses a valid lockfile", () => {
    const lock = makeLock({ agents: ["claude"] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(lock));

    const result = readLockfile(TEST_DIR);

    expect(result).toEqual(lock);
    expect(mockReadFileSync).toHaveBeenCalledWith(LOCK_PATH, "utf-8");
  });
});

describe("writeLockfile", () => {
  it("writes JSON with updated timestamp", () => {
    const lock = makeLock();

    writeLockfile(lock, TEST_DIR);

    expect(lock.updatedAt).toBe("2026-02-17T12:00:00.000Z");
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      LOCK_PATH,
      JSON.stringify(lock, null, 2) + "\n",
      "utf-8"
    );
  });
});

describe("ensureLockfile", () => {
  it("creates a new lockfile when none exists", () => {
    mockExistsSync.mockReturnValue(false);

    const result = ensureLockfile(TEST_DIR);

    expect(result.version).toBe(1);
    expect(result.agents).toEqual([]);
    expect(result.skills).toEqual({});
    expect(result.createdAt).toBe("2026-02-17T12:00:00.000Z");
    expect(mockWriteFileSync).toHaveBeenCalled();
  });

  it("returns existing lockfile without writing", () => {
    const existing = makeLock({ agents: ["cursor"] });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const result = ensureLockfile(TEST_DIR);

    expect(result).toEqual(existing);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("addSkillToLock", () => {
  it("adds a skill entry to the lockfile", () => {
    const existing = makeLock();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    const entry = makeEntry({ version: "2.0.0", tier: "VERIFIED" });
    addSkillToLock("my-skill", entry, TEST_DIR);

    // writeLockfile should have been called with the skill added
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1].trimEnd()
    );
    expect(writtenJson.skills["my-skill"]).toEqual(entry);
  });
});

describe("removeSkillFromLock", () => {
  it("removes a skill entry from the lockfile", () => {
    const existing = makeLock({
      skills: {
        "skill-a": makeEntry(),
        "skill-b": makeEntry({ version: "3.0.0" }),
      },
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(existing));

    removeSkillFromLock("skill-a", TEST_DIR);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1].trimEnd()
    );
    expect(writtenJson.skills).not.toHaveProperty("skill-a");
    expect(writtenJson.skills).toHaveProperty("skill-b");
  });

  it("is a no-op when no lockfile exists", () => {
    mockExistsSync.mockReturnValue(false);

    removeSkillFromLock("nonexistent", TEST_DIR);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
