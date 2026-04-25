// ---------------------------------------------------------------------------
// 0714: Authored-skill resolver — fallback to git remote when lockfile misses.
// RED phase: these tests describe the desired behavior of the new module
// `../skill-name-resolver.ts` and the updated resolveSkillApiName helper.
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

const {
  parseGitHubRemoteUrl,
  findAuthoredSkillDir,
  readGitOriginOwnerRepo,
  resolveSkillApiName,
  resetResolverCache,
} = await import("../skill-name-resolver.js");

// ---------------------------------------------------------------------------
// T-01: parseGitHubRemoteUrl — pure parser
// ---------------------------------------------------------------------------

describe("T-01: parseGitHubRemoteUrl", () => {
  it("TC-01a: parses HTTPS URL with .git suffix", () => {
    expect(parseGitHubRemoteUrl("https://github.com/anton-abyzov/vskill.git")).toEqual({
      owner: "anton-abyzov",
      repo: "vskill",
    });
  });

  it("TC-01b: parses HTTPS URL without .git suffix", () => {
    expect(parseGitHubRemoteUrl("https://github.com/anton-abyzov/vskill")).toEqual({
      owner: "anton-abyzov",
      repo: "vskill",
    });
  });

  it("TC-01c: parses SCP-style git@github.com URL", () => {
    expect(parseGitHubRemoteUrl("git@github.com:anton-abyzov/vskill.git")).toEqual({
      owner: "anton-abyzov",
      repo: "vskill",
    });
  });

  it("TC-01d: parses ssh:// URL", () => {
    expect(parseGitHubRemoteUrl("ssh://git@github.com/anton-abyzov/vskill.git")).toEqual({
      owner: "anton-abyzov",
      repo: "vskill",
    });
  });

  it("TC-01e: returns null for non-GitHub host", () => {
    expect(parseGitHubRemoteUrl("https://gitlab.com/x/y.git")).toBeNull();
    expect(parseGitHubRemoteUrl("https://bitbucket.org/a/b.git")).toBeNull();
  });

  it("TC-01f: returns null for empty / nullish / malformed input", () => {
    expect(parseGitHubRemoteUrl("")).toBeNull();
    expect(parseGitHubRemoteUrl(undefined as unknown as string)).toBeNull();
    expect(parseGitHubRemoteUrl("not-a-url")).toBeNull();
    expect(parseGitHubRemoteUrl("https://github.com/only-one-segment")).toBeNull();
  });

  it("TC-01g: accepts repo names containing dots (e.g. pages.github.io)", () => {
    expect(parseGitHubRemoteUrl("https://github.com/owner/pages.github.io")).toEqual({
      owner: "owner",
      repo: "pages.github.io",
    });
    expect(parseGitHubRemoteUrl("git@github.com:owner/dotted.repo.name.git")).toEqual({
      owner: "owner",
      repo: "dotted.repo.name",
    });
  });
});

// ---------------------------------------------------------------------------
// T-02: findAuthoredSkillDir — walks plugins/*/skills/<skill>/SKILL.md
// ---------------------------------------------------------------------------

describe("T-02: findAuthoredSkillDir", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "vskill-resolver-"));
  });

  function makeSkill(plugin: string, skill: string): string {
    const dir = join(tmp, "plugins", plugin, "skills", skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: " + skill + "\n---\n");
    return dir;
  }

  it("TC-02a: finds a single authored skill", async () => {
    const dir = makeSkill("mobile", "appstore");
    await expect(findAuthoredSkillDir(tmp, "appstore")).resolves.toBe(dir);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-02b: prefers lexicographically first plugin on duplicates", async () => {
    const aDir = makeSkill("a", "dup");
    makeSkill("b", "dup");
    await expect(findAuthoredSkillDir(tmp, "dup")).resolves.toBe(aDir);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-02c: returns null when no SKILL.md exists for that name", async () => {
    makeSkill("mobile", "appstore");
    await expect(findAuthoredSkillDir(tmp, "missing-skill")).resolves.toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-02d: returns null when plugins/ does not exist", async () => {
    await expect(findAuthoredSkillDir(tmp, "anything")).resolves.toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-02e: rejects path-traversal skill names", async () => {
    makeSkill("mobile", "appstore");
    await expect(findAuthoredSkillDir(tmp, "..")).resolves.toBeNull();
    await expect(findAuthoredSkillDir(tmp, "../etc/passwd")).resolves.toBeNull();
    await expect(findAuthoredSkillDir(tmp, "..\\windows")).resolves.toBeNull();
    await expect(findAuthoredSkillDir(tmp, "")).resolves.toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// T-03: readGitOriginOwnerRepo — execFile wrapper + parser
// ---------------------------------------------------------------------------

describe("T-03: readGitOriginOwnerRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("TC-03a: returns owner/repo when git outputs a parsable URL", async () => {
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const result = await readGitOriginOwnerRepo("/some/dir");
    expect(result).toEqual({ owner: "anton-abyzov", repo: "vskill" });
    expect(mocks.execFile).toHaveBeenCalledWith(
      "git",
      ["-C", "/some/dir", "config", "--get", "remote.origin.url"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("TC-03b: returns null when git fails (no repo / no git on PATH)", async () => {
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: unknown) => void;
      cb(new Error("not a git repository"), null);
    }) as never);

    const result = await readGitOriginOwnerRepo("/some/dir");
    expect(result).toBeNull();
  });

  it("TC-03c: returns null when remote URL is non-GitHub", async () => {
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://gitlab.com/x/y.git\n", stderr: "" });
    }) as never);

    const result = await readGitOriginOwnerRepo("/some/dir");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-04: resolveSkillApiName — full resolver, branches + cache
// ---------------------------------------------------------------------------

describe("T-04: resolveSkillApiName", () => {
  let tmp: string;

  beforeEach(() => {
    vi.resetAllMocks();
    resetResolverCache();
    tmp = mkdtempSync(join(tmpdir(), "vskill-resolver-"));
  });

  function makeSkill(plugin: string, skill: string): void {
    const dir = join(tmp, "plugins", plugin, "skills", skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: " + skill + "\n---\n");
  }

  it("TC-04a: lockfile hit returns owner/repo/skill without git shell-out", async () => {
    mocks.readLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        architect: {
          version: "1.0.0",
          sha: "x",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "marketplace:anthropics/skills#architect",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    mocks.parseSource.mockReturnValue({
      type: "marketplace",
      owner: "anthropics",
      repo: "skills",
      pluginName: "architect",
    });

    const result = await resolveSkillApiName("architect", tmp);

    expect(result).toBe("anthropics/skills/architect");
    expect(mocks.execFile).not.toHaveBeenCalled();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-04b: authored skill resolves via git remote", async () => {
    mocks.readLockfile.mockReturnValue(null);
    makeSkill("mobile", "appstore");
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    const result = await resolveSkillApiName("appstore", tmp);

    expect(result).toBe("anton-abyzov/vskill/appstore");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-04c: second call hits cache (no second git shell-out)", async () => {
    mocks.readLockfile.mockReturnValue(null);
    makeSkill("mobile", "appstore");
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: { stdout: string; stderr: string } | null) => void;
      cb(null, { stdout: "https://github.com/anton-abyzov/vskill.git\n", stderr: "" });
    }) as never);

    await resolveSkillApiName("appstore", tmp);
    await resolveSkillApiName("appstore", tmp);

    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-04d: no SKILL.md anywhere returns bare name", async () => {
    mocks.readLockfile.mockReturnValue(null);
    const result = await resolveSkillApiName("ghost-skill", tmp);
    expect(result).toBe("ghost-skill");
    expect(mocks.execFile).not.toHaveBeenCalled();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-04e: git failure returns bare name (graceful fallback)", async () => {
    mocks.readLockfile.mockReturnValue(null);
    makeSkill("mobile", "appstore");
    mocks.execFile.mockImplementation(((..._args: unknown[]) => {
      const cb = _args[_args.length - 1] as (err: Error | null, out: unknown) => void;
      cb(new Error("git: command not found"), null);
    }) as never);

    const result = await resolveSkillApiName("appstore", tmp);

    expect(result).toBe("appstore");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("TC-04f: lockfile entry exists but parseSource returns non-github type → bare name (no fallback)", async () => {
    mocks.readLockfile.mockReturnValue({
      version: 1,
      agents: [],
      skills: {
        weird: {
          version: "1.0.0",
          sha: "x",
          tier: "VERIFIED",
          installedAt: "2026-01-01",
          source: "local:./weird",
        },
      },
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    });
    mocks.parseSource.mockReturnValue({ type: "local" });

    const result = await resolveSkillApiName("weird", tmp);

    expect(result).toBe("weird");
    expect(mocks.execFile).not.toHaveBeenCalled();
    rmSync(tmp, { recursive: true, force: true });
  });
});
