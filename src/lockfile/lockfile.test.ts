import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VskillLock, SkillLockEntry } from "./types.js";

// ---------------------------------------------------------------------------
// Mock node:fs
// ---------------------------------------------------------------------------
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
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
    tier: "VERIFIED",
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

afterEach(() => {
  vi.useRealTimers();
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

  it("ensures parent directory exists before writing", () => {
    const lock = makeLock();

    writeLockfile(lock, "/some/deep/path");

    expect(mockMkdirSync).toHaveBeenCalledWith("/some/deep/path", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// TC-008: Extended entry with marketplace field round-trips
// ---------------------------------------------------------------------------
describe("lockfile extended fields", () => {
  it("TC-008: extended entry with marketplace field round-trips", () => {
    const extendedEntry = makeEntry({
      marketplace: "specweave",
      pluginDir: true,
      scope: "user",
      installedPath: "~/.claude/plugins/cache/specweave/sw/1.0.0",
    });

    const lock = makeLock({ skills: { "frontend": extendedEntry } });
    mockExistsSync.mockReturnValue(true);

    // Write the lockfile
    writeLockfile(lock, TEST_DIR);

    // Capture what was written
    const writtenJson = JSON.parse(
      mockWriteFileSync.mock.calls[0][1].trimEnd()
    );

    // Simulate reading it back
    mockReadFileSync.mockReturnValue(JSON.stringify(writtenJson));
    const readBack = readLockfile(TEST_DIR);

    expect(readBack).not.toBeNull();
    const entry = readBack!.skills["frontend"];
    expect(entry.marketplace).toBe("specweave");
    expect(entry.pluginDir).toBe(true);
    expect(entry.scope).toBe("user");
    expect(entry.installedPath).toBe(
      "~/.claude/plugins/cache/specweave/sw/1.0.0"
    );
    // Original fields still present
    expect(entry.version).toBe("1.0.0");
    expect(entry.sha).toBe("abc123");
    expect(entry.tier).toBe("VERIFIED");
    expect(entry.source).toBe("registry");
  });

  // TC-009: Backward-compatible with existing entries
  it("TC-009: backward-compatible with existing entries", () => {
    // Old-format entry with only the original fields
    const oldEntry = {
      version: "1.0.0",
      sha: "abc123",
      tier: "VERIFIED",
      installedAt: "2026-01-01T00:00:00.000Z",
      source: "registry",
    };
    const lock = makeLock({ skills: { "old-skill": oldEntry } });

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify(lock));

    const result = readLockfile(TEST_DIR);

    expect(result).not.toBeNull();
    const entry = result!.skills["old-skill"];
    expect(entry.version).toBe("1.0.0");
    expect(entry.sha).toBe("abc123");
    expect(entry.tier).toBe("VERIFIED");
    expect(entry.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(entry.source).toBe("registry");
    // New fields should be undefined
    expect(entry.marketplace).toBeUndefined();
    expect(entry.pluginDir).toBeUndefined();
    expect(entry.scope).toBeUndefined();
    expect(entry.installedPath).toBeUndefined();
  });
});
