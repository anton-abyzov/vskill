// ---------------------------------------------------------------------------
// 0765: Plugin-aware skill name resolver. When the route's `plugin` segment
// is an installed-agent dir (.claude, .cursor, .windsurf, ...) the resolver
// must skip the 0761 source-tree probe and consult the lockfile directly —
// the user is looking at a downstream install copy, not an authored source.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readLockfile: vi.fn(),
  parseSource: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, execFile: mocks.execFile };
});

vi.mock("../../lockfile/lockfile.js", () => ({
  readLockfile: mocks.readLockfile,
}));

vi.mock("../../resolvers/source-resolver.js", () => ({
  parseSource: mocks.parseSource,
}));

const { resolveSkillApiName, resetResolverCache, isInstalledAgentDirPlugin } =
  await import("../skill-name-resolver.js");

function makeSourceTreeSkill(tmp: string, skill: string): void {
  const dir = join(tmp, "skills", skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: " + skill + "\n---\n");
}

const LOCKFILE_GREET = {
  version: 1,
  agents: [],
  skills: {
    "greet-anton": {
      version: "1.0.2",
      sha: "x",
      tier: "VERIFIED" as const,
      installedAt: "2026-01-01",
      source: "github:anton-abyzov/greet-anton",
    },
  },
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

const PARSED_GREET = {
  type: "github" as const,
  owner: "anton-abyzov",
  repo: "greet-anton",
};

describe("0765 isInstalledAgentDirPlugin", () => {
  it("returns true for known agent dirs", () => {
    for (const p of [".claude", ".cursor", ".windsurf", ".codex", ".openclaw", ".agent", ".kiro", ".gemini", ".aider", ".copilot", ".opencode", ".pi"]) {
      expect(isInstalledAgentDirPlugin(p)).toBe(true);
    }
  });

  it("returns false for authoring plugin names and falsy values", () => {
    for (const p of ["vskill", "skills", "specweave", "personal", "project", "", null, undefined]) {
      expect(isInstalledAgentDirPlugin(p)).toBe(false);
    }
  });
});

describe("0765 resolveSkillApiName — plugin-aware lookup", () => {
  let tmp: string;

  beforeEach(() => {
    vi.resetAllMocks();
    resetResolverCache();
    tmp = mkdtempSync(join(tmpdir(), "vskill-resolver-0765-"));
  });

  it("AC-US1-01: installed-agent view (plugin='.claude') uses lockfile, NOT source-tree", async () => {
    // Given a source-tree skill at <root>/skills/greet-anton/ AND a lockfile
    //   entry with source github:anton-abyzov/greet-anton,
    // When the user views .claude/greet-anton (installed copy),
    // Then the resolver returns the lockfile-derived owner/repo, NOT the
    //   vskill repo's git remote.
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue(LOCKFILE_GREET);
    mocks.parseSource.mockReturnValue(PARSED_GREET);
    // git remote would point at vskill — should never be called for
    // installed-agent view.
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const result = await resolveSkillApiName("greet-anton", tmp, ".claude");

    expect(result).toBe("anton-abyzov/greet-anton/greet-anton");
    // Source-tree probe must be skipped — git remote of the vskill repo
    // must NOT have been read.
    expect(mocks.execFile).not.toHaveBeenCalled();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-US1-02: authoring view (plugin='vskill') still runs source-tree probe first (no regression)", async () => {
    // Given the same source-tree skill AND lockfile,
    // When the user views vskill/greet-anton (authoring source),
    // Then 0761 source-tree behavior wins → vskill repo's git remote.
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue(LOCKFILE_GREET);
    mocks.parseSource.mockReturnValue(PARSED_GREET);
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const result = await resolveSkillApiName("greet-anton", tmp, "vskill");

    expect(result).toBe("anton-abyzov/vskill/greet-anton");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("AC-US1-03: cache is keyed by (skill, plugin) so installed and authoring don't collide", async () => {
    // Given two consecutive calls with different plugins,
    // Then both results are cached independently.
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue(LOCKFILE_GREET);
    mocks.parseSource.mockReturnValue(PARSED_GREET);
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const installed = await resolveSkillApiName("greet-anton", tmp, ".claude");
    const authoring = await resolveSkillApiName("greet-anton", tmp, "vskill");
    // Repeat both — must hit cache (no second git call for authoring view).
    const installed2 = await resolveSkillApiName("greet-anton", tmp, ".claude");
    const authoring2 = await resolveSkillApiName("greet-anton", tmp, "vskill");

    expect(installed).toBe("anton-abyzov/greet-anton/greet-anton");
    expect(installed2).toBe("anton-abyzov/greet-anton/greet-anton");
    expect(authoring).toBe("anton-abyzov/vskill/greet-anton");
    expect(authoring2).toBe("anton-abyzov/vskill/greet-anton");
    // git was read exactly once (for the authoring view's first call).
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("installed-agent view with NO lockfile entry → bare name (graceful)", async () => {
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue(null);

    const result = await resolveSkillApiName("greet-anton", tmp, ".cursor");

    expect(result).toBe("greet-anton");
    expect(mocks.execFile).not.toHaveBeenCalled();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("installed-agent view with lockfile entry that has unparseable source → bare name", async () => {
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue({
      ...LOCKFILE_GREET,
      skills: {
        "greet-anton": {
          ...LOCKFILE_GREET.skills["greet-anton"],
          source: "registry:something-weird",
        },
      },
    });
    mocks.parseSource.mockReturnValue({ type: "registry", owner: null, repo: null });

    const result = await resolveSkillApiName("greet-anton", tmp, ".claude");

    expect(result).toBe("greet-anton");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("legacy two-arg call (no plugin) preserves authoring-view behavior", async () => {
    // Backwards compatibility: tests + other internal callers that pass only
    // (skill, root) get the pre-0765 behavior (source-tree probe runs first).
    makeSourceTreeSkill(tmp, "greet-anton");
    mocks.readLockfile.mockReturnValue(LOCKFILE_GREET);
    mocks.parseSource.mockReturnValue(PARSED_GREET);
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const result = await resolveSkillApiName("greet-anton", tmp);

    expect(result).toBe("anton-abyzov/vskill/greet-anton");
    rmSync(tmp, { recursive: true, force: true });
  });
});
