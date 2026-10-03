import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubVisibility = vi.hoisted(() => new Map<string, "public" | "private">());
const getDefaultBranch = vi.hoisted(() => vi.fn());
vi.mock("../../discovery/github-tree.js", async () => {
  const visibility = await import("../repo-visibility.js");
  getDefaultBranch.mockImplementation(async (owner: string, repo: string) => {
    const v = githubVisibility.get(`${owner}/${repo}`);
    if (v) visibility.recordRepoVisibility(owner, repo, { visibility: v });
    return "main";
  });
  return { getDefaultBranch };
});

const { findLockEntry, isPrivateSource, parseGitHubRepoRef, filterPublicEntries } = await import("../private-source.js");
const { _resetRepoVisibilityForTests, getRepoVisibility, recordRepoVisibility } = await import("../repo-visibility.js");

function entry(source: string, extra: Record<string, unknown> = {}) {
  return { version: "1.0.0", sha: "x", tier: "VERIFIED", installedAt: "", source, ...extra };
}

beforeEach(() => {
  githubVisibility.clear();
  _resetRepoVisibilityForTests();
  getDefaultBranch.mockClear();
});

describe("repo visibility", () => {
  it("is unknown until GitHub explicitly says public or private", () => {
    expect(getRepoVisibility("acme/a")).toBe("unknown");
    recordRepoVisibility("acme", "a", {});
    expect(getRepoVisibility("acme/a")).toBe("unknown");
    recordRepoVisibility("acme", "a", { private: false });
    expect(getRepoVisibility("https://github.com/ACME/a.git")).toBe("public");
    recordRepoVisibility("acme", "a", { visibility: "internal" });
    expect(getRepoVisibility("acme/a")).toBe("private");
  });
});

describe("parseGitHubRepoRef", () => {
  it.each([
    ["acme/repo", { owner: "acme", repo: "repo" }],
    ["https://github.com/acme/repo", { owner: "acme", repo: "repo" }],
    ["https://github.com/acme/repo.git", { owner: "acme", repo: "repo" }],
    ["git@github.com:acme/repo.git", { owner: "acme", repo: "repo" }],
    ["ssh://git@github.com/acme/repo.git", { owner: "acme", repo: "repo" }],
  ])("%s", (ref, expected) => {
    expect(parseGitHubRepoRef(ref)).toEqual(expected);
  });

  it.each(["https://gitlab.com/acme/repo.git", "git@gitlab.com:acme/repo.git", "", "nope"])(
    "rejects %s",
    (ref) => {
      expect(parseGitHubRepoRef(ref)).toBeNull();
    },
  );
});

describe("isPrivateSource", () => {
  it("fails closed for GitHub sources GitHub does not confirm public", async () => {
    githubVisibility.set("acme/open", "public");
    githubVisibility.set("acme/closed", "private");

    expect(await isPrivateSource(entry("github:acme/open"))).toBe(false);
    expect(await isPrivateSource(entry("github:acme/closed"))).toBe(true);
    expect(await isPrivateSource(entry("github:acme/unknown"))).toBe(true);
    expect(await isPrivateSource(entry("marketplace:acme/unknown#p"))).toBe(true);
    expect(await isPrivateSource(entry("github:acme/open#plugin:p"))).toBe(false);
  });

  it("trusts sourcePrivate and registry sources without asking GitHub", async () => {
    expect(await isPrivateSource(entry("github:acme/open", { sourcePrivate: true }))).toBe(true);
    expect(await isPrivateSource(entry("registry:foo"))).toBe(false);
    expect(await isPrivateSource(null)).toBe(false);
    expect(getDefaultBranch).not.toHaveBeenCalled();
  });

  it("treats a local plugin dir without a GitHub origin as private", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vskill-local-src-"));
    try {
      expect(await isPrivateSource(entry(`local:${dir}`))).toBe(true);
      expect(await isPrivateSource(entry("local:/definitely/not/here"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves an unknown-source entry through its sourceRepoUrl", async () => {
    githubVisibility.set("acme/open", "public");
    expect(await isPrivateSource(entry("", { sourceRepoUrl: "https://github.com/acme/open" }))).toBe(false);
    expect(await isPrivateSource(entry("", { sourceRepoUrl: "https://github.com/acme/secret" }))).toBe(true);
    expect(await isPrivateSource(entry(""))).toBe(false);
  });

  it("filterPublicEntries keeps order and drops private entries", async () => {
    githubVisibility.set("acme/open", "public");
    const kept = await filterPublicEntries([
      ["a", entry("github:acme/secret")],
      ["b", entry("registry:b")],
      ["c", entry("github:acme/open")],
    ]);
    expect(kept.map(([name]) => name)).toEqual(["b", "c"]);
  });
});

describe("findLockEntry", () => {
  const lock = {
    version: 1 as const,
    agents: [],
    createdAt: "",
    updatedAt: "",
    skills: { "resume-tuner": entry("github:acme/secret-skills") },
  };

  it("matches the lock key and the canonical owner/repo/skill name", () => {
    expect(findLockEntry(lock, "resume-tuner")).toBe(lock.skills["resume-tuner"]);
    expect(findLockEntry(lock, "Acme/Secret-Skills/resume-tuner")).toBe(lock.skills["resume-tuner"]);
    expect(findLockEntry(lock, "other/repo/resume-tuner")).toBeNull();
    expect(findLockEntry(null, "resume-tuner")).toBeNull();
  });
});
