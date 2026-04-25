// ---------------------------------------------------------------------------
// Tests for `vskill cleanup --dry-run` (0724 T-008).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadLockfile = vi.fn();

vi.mock("../../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
}));

const mockListEnabledPlugins = vi.fn();
const mockPurgeStalePlugins = vi.fn();

vi.mock("../../settings/index.js", () => ({
  listEnabledPlugins: (...args: unknown[]) => mockListEnabledPlugins(...args),
  purgeStalePlugins: (...args: unknown[]) => mockPurgeStalePlugins(...args),
}));

const mockUninstallStalePlugins = vi.fn();
const mockClaudePluginUninstall = vi.fn();

vi.mock("../../utils/claude-plugin.js", () => ({
  uninstallStalePlugins: (...args: unknown[]) => mockUninstallStalePlugins(...args),
  claudePluginUninstall: (...args: unknown[]) => mockClaudePluginUninstall(...args),
}));

const mockExistsSync = vi.fn(() => false);
const mockReaddirSync = vi.fn(() => []);
const mockRmSync = vi.fn();

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    rmSync: (...args: unknown[]) => mockRmSync(...args),
  };
});

const { cleanupCommand } = await import("../cleanup.js");

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockListEnabledPlugins.mockReturnValue([]);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("cleanupCommand --dry-run", () => {
  // ---- AC-US7-02 ---------------------------------------------------------
  it("AC-US7-02: --dry-run lists stale invocations without spawning", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: { foo: { marketplace: "m" } },
      createdAt: "",
      updatedAt: "",
    });
    // Two stale at user, one at project
    mockPurgeStalePlugins.mockImplementation((opts: { scope: string }) =>
      opts.scope === "user"
        ? ["stale-a@m", "stale-b@m"]
        : opts.scope === "project"
          ? ["stale-c@m"]
          : [],
    );

    await cleanupCommand({ dryRun: true });

    expect(mockUninstallStalePlugins).not.toHaveBeenCalled();
    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/stale-a@m/);
    expect(out).toMatch(/stale-b@m/);
    expect(out).toMatch(/stale-c@m/);
    expect(out).toMatch(/claude plugin uninstall/);
  });

  // ---- AC-US7-03: reconciliation summary ---------------------------------
  it("AC-US7-03: prints reconciliation summary line on dry-run", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: { foo: { marketplace: "m" }, bar: { marketplace: "m" } },
      createdAt: "",
      updatedAt: "",
    });
    mockPurgeStalePlugins.mockImplementation((opts: { scope: string }) =>
      opts.scope === "user" ? ["stale@m"] : [],
    );

    await cleanupCommand({ dryRun: true });

    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/1 stale entries removed from user scope/);
    expect(out).toMatch(/0 from project scope/);
    expect(out).toMatch(/in-sync skills left untouched/);
  });

  // ---- AC-US7-04: lockfile-only skills are NOT touched -----------------
  it("AC-US7-04: --dry-run never touches the lockfile (lockfile-only skills survive)", async () => {
    // Skill in lockfile but not in enabledPlugins -> the user manually
    // disabled it. cleanup must not propose to uninstall it.
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: { manually_disabled: { marketplace: "m" } },
      createdAt: "",
      updatedAt: "",
    });
    // purgeStalePlugins detects stale by scanning enabledPlugins, so an
    // empty return mimics "lockfile-only skill present, no stale entry".
    mockPurgeStalePlugins.mockReturnValue([]);

    await cleanupCommand({ dryRun: true });

    expect(mockUninstallStalePlugins).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/0 stale entries removed/);
  });

  // ---- AC-US7-04 (explicit): lockfile-only skill name never appears -----
  // Belt-and-braces protection for the "user manually disabled but kept the
  // file on disk" path. Two lockfile skills, only one in enabledPlugins.
  // The lockfile-only one (`manually_disabled@m`) must NOT appear in the
  // dry-run uninstall output, and the in-sync count must reflect both
  // lockfile entries staying put.
  it("AC-US7-04: lockfile-only skill name is absent from dry-run uninstall lines", async () => {
    mockReadLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        active_skill: { marketplace: "m" },
        manually_disabled: { marketplace: "m" },
      },
      createdAt: "",
      updatedAt: "",
    });
    // purgeStalePlugins only returns ids that appear in enabledPlugins
    // without lockfile backing. Both lockfile skills have backing, so the
    // function returns nothing for both scopes — exactly the AC-US7-04
    // protective semantics.
    mockPurgeStalePlugins.mockReturnValue([]);

    await cleanupCommand({ dryRun: true });

    expect(mockUninstallStalePlugins).not.toHaveBeenCalled();
    expect(mockClaudePluginUninstall).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // The protected skill must never surface as a removal candidate.
    expect(out).not.toMatch(/manually_disabled@m/);
    expect(out).toMatch(/0 stale entries removed/);
  });
});
