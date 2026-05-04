// ---------------------------------------------------------------------------
// Unit tests for src/clone/github-scaffold.ts (T-015, AC-US3-02, AC-US3-03).
//
// Uses an injectable `runGh` fake to verify:
//   - argv composition for `gh repo create` (positional name, visibility flag,
//     --source, --push, optional --description)
//   - success path with repoUrl extraction from gh stdout
//   - graceful skip when fake throws ENOENT (gh not installed)
//   - graceful skip when gh exits non-zero (auth, rate limit, name taken)
//   - graceful skip on arbitrary spawn errors
//   - --private path
//
// No real subprocess is spawned; the fake records every invocation so we can
// assert the exact argv passed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { scaffoldGitHub } from "../github-scaffold.js";
import type { RunGh, RunGhResult } from "../github-scaffold.js";

function fakeOk(stdout = "https://github.com/anton/repo-name\n"): RunGh {
  return vi.fn(async () => ({ stdout, stderr: "", code: 0 } as RunGhResult));
}

describe("scaffoldGitHub — success path", () => {
  it("invokes gh with [repo, create, <name>, --public, --source <dir>, --push]", async () => {
    const fake = fakeOk();

    await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "anton-ado-tools",
      runGh: fake,
    });

    expect(fake).toHaveBeenCalledTimes(1);
    const [argv, opts] = (fake as unknown as ReturnType<typeof vi.fn>).mock.calls[0];

    expect(argv).toEqual([
      "repo",
      "create",
      "anton-ado-tools",
      "--public",
      "--source",
      "/abs/plugin",
      "--push",
    ]);
    expect(opts).toEqual({ cwd: "/abs/plugin" });
  });

  it("includes --description when supplied", async () => {
    const fake = fakeOk();

    await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      description: "My forked plugin.",
      runGh: fake,
    });

    const [argv] = (fake as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(argv).toContain("--description");
    expect(argv[argv.indexOf("--description") + 1]).toBe("My forked plugin.");
  });

  it("uses --private when public:false", async () => {
    const fake = fakeOk();

    await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      public: false,
      runGh: fake,
    });

    const [argv] = (fake as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(argv).toContain("--private");
    expect(argv).not.toContain("--public");
  });

  it("returns skipped:false and repoUrl extracted from gh stdout", async () => {
    const fake = fakeOk("Created https://github.com/anton/cool-skill on first try\n");

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "cool-skill",
      runGh: fake,
    });

    expect(result.skipped).toBe(false);
    expect(result.repoUrl).toBe("https://github.com/anton/cool-skill");
    expect(result.invocations).toHaveLength(1);
    expect(result.invocations[0]).toEqual([
      "repo",
      "create",
      "cool-skill",
      "--public",
      "--source",
      "/abs/plugin",
      "--push",
    ]);
  });

  it("leaves repoUrl undefined when gh stdout does not contain a github.com URL", async () => {
    const fake = fakeOk("ok\n");

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      runGh: fake,
    });

    expect(result.skipped).toBe(false);
    expect(result.repoUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("scaffoldGitHub — graceful skip paths (AC-US3-02)", () => {
  it("skips with a 'gh CLI not installed' reason when fake throws ENOENT", async () => {
    const fake: RunGh = vi.fn(async () => {
      const err = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      runGh: fake,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/gh CLI not installed/);
    expect(result.repoUrl).toBeUndefined();
  });

  it("skips with a generic 'gh invocation failed' reason on any other error", async () => {
    const fake: RunGh = vi.fn(async () => {
      throw new Error("kaboom");
    });

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      runGh: fake,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/gh invocation failed/);
    expect(result.reason).toMatch(/kaboom/);
  });

  it("skips when gh exits with non-zero code (e.g. repo name taken)", async () => {
    const fake: RunGh = vi.fn(async () => ({
      stdout: "",
      stderr: "GraphQL: Name already exists on this account",
      code: 1,
    }));

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      runGh: fake,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/exited 1/);
    expect(result.reason).toMatch(/Name already exists/);
  });

  it("falls back to stdout when stderr is empty on non-zero exit", async () => {
    const fake: RunGh = vi.fn(async () => ({
      stdout: "fatal: not a git repository",
      stderr: "",
      code: 128,
    }));

    const result = await scaffoldGitHub({
      pluginDir: "/abs/plugin",
      repoName: "x",
      runGh: fake,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/not a git repository/);
  });

  it("never throws — failures always resolve with skipped:true", async () => {
    const fake: RunGh = vi.fn(async () => {
      throw new Error("anything");
    });

    await expect(
      scaffoldGitHub({ pluginDir: "/abs/plugin", repoName: "x", runGh: fake }),
    ).resolves.toMatchObject({ skipped: true });
  });
});
