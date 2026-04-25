// ---------------------------------------------------------------------------
// Tests for `vskill list --installed` (0724 T-005).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadLockfile = vi.fn();

vi.mock("../../lockfile/index.js", () => ({
  readLockfile: (...args: unknown[]) => mockReadLockfile(...args),
  // listSkills (the existing list path) calls readSkillsShLock too.
  readSkillsShLock: () => [],
}));

const mockIsPluginEnabled = vi.fn();

vi.mock("../../settings/index.js", () => ({
  isPluginEnabled: (...args: unknown[]) => mockIsPluginEnabled(...args),
}));

vi.mock("../../agents/agents-registry.js", () => ({
  detectInstalledAgents: vi.fn(async () => []),
  AGENTS_REGISTRY: [],
}));

const { listCommand } = await import("../list.js");

const FOO = {
  version: "1.0.0",
  sha: "a",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source: "marketplace:o/r#foo",
  marketplace: "m",
};
const BAR = {
  version: "2.0.0",
  sha: "b",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source: "marketplace:o/r#bar",
  marketplace: "m",
};
const BAZ = {
  // no marketplace -> auto-discovered
  version: "0.1.0",
  sha: "c",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00.000Z",
  source: "github:o/r#baz",
};

let logSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

function lockOf(skills: Record<string, unknown>) {
  return {
    version: 1,
    agents: [],
    skills,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);
});

describe("listCommand --installed", () => {
  // ---- AC-US4-01 ---------------------------------------------------------
  it("AC-US4-01: prints table with three rows showing enabled/disabled/n/a", async () => {
    mockReadLockfile.mockReturnValue(lockOf({ foo: FOO, bar: BAR, baz: BAZ }));
    // foo enabled at user, bar enabled at project, baz auto-discovered
    mockIsPluginEnabled.mockImplementation(
      (id: string, opts: { scope: string }) => {
        if (id === "foo@m" && opts.scope === "user") return true;
        if (id === "bar@m" && opts.scope === "project") return true;
        return false;
      },
    );

    await listCommand({ installed: true });

    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toMatch(/foo/);
    expect(out).toMatch(/bar/);
    expect(out).toMatch(/baz/);
    // baz row should contain n/a (auto-discovered)
    const bazLine = out.split("\n").find((l) => l.includes("baz")) ?? "";
    expect(bazLine).toMatch(/n\/a/);
    // foo row should show enabled (user) + disabled (project) — both columns present
    const fooLine = out.split("\n").find((l) => l.includes("foo")) ?? "";
    expect(fooLine).toMatch(/enabled/);
    expect(fooLine).toMatch(/disabled/);
  });

  // ---- AC-US4-03 ---------------------------------------------------------
  it("AC-US4-03: --installed --json emits valid JSON array with shape", async () => {
    mockReadLockfile.mockReturnValue(lockOf({ foo: FOO, baz: BAZ }));
    mockIsPluginEnabled.mockImplementation(
      (id: string, opts: { scope: string }) =>
        id === "foo@m" && opts.scope === "user",
    );

    await listCommand({ installed: true, json: true });

    const last = logSpy.mock.calls[logSpy.mock.calls.length - 1];
    const parsed = JSON.parse(last.join(" "));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);

    const foo = parsed.find((p: { name: string }) => p.name === "foo");
    expect(foo).toBeDefined();
    expect(foo.enabledUser).toBe(true);
    expect(foo.enabledProject).toBe(false);
    expect(foo.autoDiscovered).toBe(false);

    const baz = parsed.find((p: { name: string }) => p.name === "baz");
    expect(baz.autoDiscovered).toBe(true);
  });

  // ---- AC-US4-04 ---------------------------------------------------------
  it("AC-US4-04: missing lockfile produces friendly message and exits 1 (matching listSkills)", async () => {
    mockReadLockfile.mockReturnValue(null);

    await listCommand({ installed: true });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  // ---- AC-US4-02 ---------------------------------------------------------
  it("AC-US4-02: missing settings.json -> all marketplace skills show disabled, no crash", async () => {
    mockReadLockfile.mockReturnValue(lockOf({ foo: FOO }));
    mockIsPluginEnabled.mockReturnValue(false); // simulates "no enabledPlugins entry"

    await expect(listCommand({ installed: true })).resolves.not.toThrow();
    const out = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    const fooLine = out.split("\n").find((l) => l.includes("foo")) ?? "";
    expect(fooLine).toMatch(/disabled/);
  });
});
