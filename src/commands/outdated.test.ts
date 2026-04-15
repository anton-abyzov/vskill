// ---------------------------------------------------------------------------
// Tests for vskill outdated command (T-007, T-008, T-009)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheckUpdates = vi.hoisted(() => vi.fn());
const mockReadLockfile = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  checkUpdates: mockCheckUpdates,
}));

vi.mock("../resolvers/source-resolver.js", () => ({
  parseSource: vi.fn((source: string) => {
    if (source.startsWith("github:")) {
      const rest = source.slice("github:".length);
      const slash = rest.indexOf("/");
      if (slash !== -1) {
        return { type: "github", owner: rest.slice(0, slash), repo: rest.slice(slash + 1) };
      }
    }
    if (source.startsWith("marketplace:")) {
      const rest = source.slice("marketplace:".length);
      const hash = rest.indexOf("#");
      if (hash !== -1) {
        const ownerRepo = rest.slice(0, hash);
        const slash = ownerRepo.indexOf("/");
        return { type: "marketplace", owner: ownerRepo.slice(0, slash), repo: ownerRepo.slice(slash + 1), pluginName: rest.slice(hash + 1) };
      }
    }
    return { type: "unknown", raw: source };
  }),
}));

const mockWriteLockfile = vi.hoisted(() => vi.fn());

vi.mock("../lockfile/lockfile.js", () => ({
  readLockfile: mockReadLockfile,
  writeLockfile: mockWriteLockfile,
}));

const logs: string[] = [];
const errors: string[] = [];
let exitCode: number | undefined;

import { outdatedCommand, postInstallHint } from "./outdated.js";
import type { VskillLock } from "../lockfile/types.js";

describe("outdatedCommand", () => {
  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    vi.spyOn(process, "exit").mockImplementation((code?: number | string | null | undefined) => {
      exitCode = typeof code === "number" ? code : 1;
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // T-007: Empty/missing lockfile
  it("prints 'No skills installed.' when lockfile is null", async () => {
    mockReadLockfile.mockReturnValue(null);

    await outdatedCommand({});

    expect(logs.join("\n")).toContain("No skills installed");
  });

  it("prints 'No skills installed.' when lockfile has empty skills", async () => {
    mockReadLockfile.mockReturnValue({ version: 1, skills: {}, agents: [] });

    await outdatedCommand({});

    expect(logs.join("\n")).toContain("No skills installed");
  });

  // T-007: Reads lockfile and resolves full names
  it("calls checkUpdates with resolved skill names from lockfile", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:anton/specweave" },
        "do": { version: "2.0.0", sha: "def", tier: "CERTIFIED", installedAt: "", source: "marketplace:anton/specweave#sw" },
      },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "anton/specweave/pm", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
      { name: "anton/specweave/do", installed: "2.0.0", latest: "2.0.0", updateAvailable: false },
    ]);

    await outdatedCommand({});

    expect(mockCheckUpdates).toHaveBeenCalledWith([
      { name: "anton/specweave/pm", currentVersion: "1.0.0", sha: "abc" },
      { name: "anton/specweave/do", currentVersion: "2.0.0", sha: "def" },
    ]);
  });

  // T-008: All up to date
  it("prints 'All skills are up to date.' when none outdated", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/pm", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
    ]);

    await outdatedCommand({});

    expect(logs.join("\n")).toContain("All skills are up to date");
  });

  // T-008: Table rendering with outdated skills
  it("shows table with outdated skills and exits with code 1", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: {
        "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" },
        "do": { version: "2.0.0", sha: "def", tier: "CERTIFIED", installedAt: "", source: "github:a/b" },
      },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/pm", installed: "1.0.0", latest: "1.1.0", updateAvailable: true, versionBump: "minor", certTier: "VERIFIED" },
      { name: "a/b/do", installed: "2.0.0", latest: "2.0.0", updateAvailable: false },
    ]);

    await expect(outdatedCommand({})).rejects.toThrow("process.exit");

    const output = logs.join("\n");
    expect(output).toContain("pm");
    expect(output).toContain("1.0.0");
    expect(output).toContain("1.1.0");
    expect(output).toContain("minor");
    expect(exitCode).toBe(1);
  });

  // T-009: --json flag
  it("outputs raw JSON when --json flag is set", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    const apiResults = [
      { name: "a/b/pm", installed: "1.0.0", latest: "1.1.0", updateAvailable: true, versionBump: "minor" },
    ];
    mockCheckUpdates.mockResolvedValue(apiResults);

    await expect(outdatedCommand({ json: true })).rejects.toThrow("process.exit");

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual(apiResults);
    expect(exitCode).toBe(1);
  });

  it("outputs JSON with exit 0 when all up to date and --json", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/pm", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
    ]);

    await outdatedCommand({ json: true });

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([
      { name: "a/b/pm", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
    ]);
  });

  // T-009: API errors
  it("prints error to stderr and exits 1 on API failure", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    mockCheckUpdates.mockRejectedValue(new Error("API request failed: 500 Internal Server Error"));

    await expect(outdatedCommand({})).rejects.toThrow("process.exit");

    const errOutput = errors.join("\n");
    expect(errOutput).toContain("Failed to check for updates");
    expect(exitCode).toBe(1);
  });

  it("outputs JSON error object and exits 1 on API failure with --json", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    mockCheckUpdates.mockRejectedValue(new Error("network error"));

    await expect(outdatedCommand({ json: true })).rejects.toThrow("process.exit");

    const jsonOutput = logs.join("\n");
    const parsed = JSON.parse(jsonOutput);
    expect(parsed.error).toContain("network error");
    expect(parsed.results).toEqual([]);
    expect(exitCode).toBe(1);
  });

  // T-007: Skills with unknown source type keep short name
  it("keeps short name for skills with unknown source type", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "local-skill": { version: "0.1.0", sha: "xyz", tier: "VERIFIED", installedAt: "", source: "local:my-dir" } },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "local-skill", installed: "0.1.0", latest: "0.1.0", updateAvailable: false },
    ]);

    await outdatedCommand({});

    expect(mockCheckUpdates).toHaveBeenCalledWith([
      { name: "local-skill", currentVersion: "0.1.0", sha: "xyz" },
    ]);
  });

  // Pin display: shows pin column for pinned skills
  it("shows pin indicator for pinned skills in table", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: {
        "architect": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b", pinnedVersion: "1.0.0" },
        "pm": { version: "1.0.0", sha: "def", tier: "VERIFIED", installedAt: "", source: "github:a/b" },
      },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/architect", installed: "1.0.0", latest: "2.0.0", updateAvailable: true, versionBump: "major", certTier: "CERTIFIED" },
      { name: "a/b/pm", installed: "1.0.0", latest: "1.1.0", updateAvailable: true, versionBump: "minor", certTier: "VERIFIED" },
    ]);

    await expect(outdatedCommand({})).rejects.toThrow("process.exit");

    const output = logs.join("\n");
    expect(output).toContain("Pin");
    expect(output).toContain("📌");
    // Summary should exclude pinned from count
    expect(output).toContain("1 skill(s) have updates available");
    expect(output).toContain("1 pinned");
  });

  // Pin display: --json enriches pinned skills
  it("enriches --json output with pinned field", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: {
        "architect": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b", pinnedVersion: "1.0.0" },
      },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/architect", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
    ]);

    await expect(outdatedCommand({ json: true })).rejects.toThrow("process.exit");

    const output = logs.join("\n");
    const parsed = JSON.parse(output);
    const arch = parsed.find((r: any) => r.name.includes("architect"));
    expect(arch.pinned).toBe(true);
    expect(arch.pinnedVersion).toBe("1.0.0");
  });

  // T-008: Table headers
  it("displays table headers for outdated results", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1, agents: [],
      skills: { "pm": { version: "1.0.0", sha: "abc", tier: "VERIFIED", installedAt: "", source: "github:a/b" } },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/pm", installed: "1.0.0", latest: "2.0.0", updateAvailable: true, versionBump: "major", certTier: "CERTIFIED" },
    ]);

    await expect(outdatedCommand({})).rejects.toThrow("process.exit");

    const output = logs.join("\n");
    expect(output).toContain("Skill");
    expect(output).toContain("Installed");
    expect(output).toContain("Latest");
    expect(output).toContain("Bump");
    expect(output).toContain("Tier");
  });
});

describe("postInstallHint", () => {
  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeLock(skills: Record<string, { version: string; sha: string; source: string }>, lastUpdateCheck?: string): VskillLock {
    const entries: Record<string, any> = {};
    for (const [name, s] of Object.entries(skills)) {
      entries[name] = { ...s, tier: "VERIFIED", installedAt: "" };
    }
    return { version: 1, agents: [], skills: entries, createdAt: "", updatedAt: "", lastUpdateCheck };
  }

  // T-011: Prints hint when updates are available
  it("prints hint when other skills have updates", async () => {
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/do", installed: "2.0.0", latest: "2.1.0", updateAvailable: true },
    ]);

    await postInstallHint(lock, "/tmp", ["pm"]);

    expect(logs.join("\n")).toContain("1 skill(s) have updates available");
    expect(logs.join("\n")).toContain("vskill outdated");
  });

  // T-011: Skips when only 1 skill in lockfile
  it("skips when only 1 skill in lockfile", async () => {
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
    });

    await postInstallHint(lock, "/tmp", ["pm"]);

    expect(mockCheckUpdates).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  // T-012: Skips when within 24h window
  it("skips check when lastUpdateCheck is within 24h", async () => {
    const recentCheck = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    }, recentCheck);

    await postInstallHint(lock, "/tmp", ["pm"]);

    expect(mockCheckUpdates).not.toHaveBeenCalled();
  });

  // T-012: Checks when lastUpdateCheck is older than 24h
  it("checks when lastUpdateCheck is older than 24h", async () => {
    const oldCheck = new Date(Date.now() - 86_400_001).toISOString(); // just over 24h
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    }, oldCheck);
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/do", installed: "2.0.0", latest: "2.0.0", updateAvailable: false },
    ]);

    await postInstallHint(lock, "/tmp", ["pm"]);

    expect(mockCheckUpdates).toHaveBeenCalled();
  });

  // T-012: Writes lastUpdateCheck after check
  it("writes lastUpdateCheck to lockfile after check", async () => {
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    });
    mockCheckUpdates.mockResolvedValue([]);

    await postInstallHint(lock, "/tmp/dir", ["pm"]);

    expect(lock.lastUpdateCheck).toBeDefined();
    expect(mockWriteLockfile).toHaveBeenCalledWith(lock, "/tmp/dir");
  });

  // T-013: Silently swallows errors
  it("silently swallows API errors", async () => {
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    });
    mockCheckUpdates.mockRejectedValue(new Error("network error"));

    // Should not throw
    await expect(postInstallHint(lock, "/tmp", ["pm"])).resolves.toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  // T-011: No hint printed when no outdated
  it("does not print hint when all other skills are up to date", async () => {
    const lock = makeLock({
      "pm": { version: "1.0.0", sha: "abc", source: "github:a/b" },
      "do": { version: "2.0.0", sha: "def", source: "github:a/b" },
    });
    mockCheckUpdates.mockResolvedValue([
      { name: "a/b/do", installed: "2.0.0", latest: "2.0.0", updateAvailable: false },
    ]);

    await postInstallHint(lock, "/tmp", ["pm"]);

    expect(logs.join("\n")).not.toContain("updates available");
  });
});
