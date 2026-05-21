import { describe, expect, it } from "vitest";

import {
  buildConnectedRepoLookup,
  parseGithubRepoSlug,
  resolveSkillRepoVisibility,
} from "../useSkillRepoVisibility";
import type { ConnectedRepoDTO } from "../../types/account";

const repo = (
  ownerLogin: string,
  repoName: string,
  isPrivate: boolean,
): ConnectedRepoDTO => ({
  repoId: `${ownerLogin}-${repoName}`,
  ownerLogin,
  ownerAvatarUrl: "",
  repoName,
  repoFullName: `${ownerLogin}/${repoName}`,
  isPrivate,
  skillsCount: 0,
  syncStatus: "green",
  lastSyncedAt: null,
  lastActivityAt: null,
  lastErrorMessage: null,
  githubInstallationId: "1",
});

describe("parseGithubRepoSlug", () => {
  it("extracts owner/name from https URLs (lowercased)", () => {
    expect(parseGithubRepoSlug("https://github.com/Anton-Abyzov/Vskill")).toBe(
      "anton-abyzov/vskill",
    );
  });

  it("strips trailing .git and slash", () => {
    expect(parseGithubRepoSlug("https://github.com/foo/bar.git")).toBe(
      "foo/bar",
    );
    expect(parseGithubRepoSlug("https://github.com/foo/bar/")).toBe("foo/bar");
  });

  it("handles ssh-style git URLs", () => {
    expect(parseGithubRepoSlug("git@github.com:foo/bar.git")).toBe("foo/bar");
  });

  it("returns null for non-GitHub or empty URLs", () => {
    expect(parseGithubRepoSlug(null)).toBeNull();
    expect(parseGithubRepoSlug("")).toBeNull();
    expect(parseGithubRepoSlug("https://gitlab.com/foo/bar")).toBeNull();
  });
});

describe("resolveSkillRepoVisibility", () => {
  const lookup = buildConnectedRepoLookup([
    repo("anton-abyzov", "vskill", false),
    repo("anton-abyzov", "private-stuff", true),
  ]);

  it("returns private + repo for a matching private repo", () => {
    const r = resolveSkillRepoVisibility(
      "https://github.com/anton-abyzov/private-stuff",
      lookup,
    );
    expect(r.visibility).toBe("private");
    expect(r.repo?.repoFullName).toBe("anton-abyzov/private-stuff");
  });

  it("returns public + repo for a matching public repo", () => {
    const r = resolveSkillRepoVisibility(
      "https://github.com/anton-abyzov/vskill",
      lookup,
    );
    expect(r.visibility).toBe("public");
    expect(r.repo?.repoFullName).toBe("anton-abyzov/vskill");
  });

  it("returns unknown when no match (public registry / marketplace)", () => {
    const r = resolveSkillRepoVisibility(
      "https://github.com/anthropic/skills",
      lookup,
    );
    expect(r.visibility).toBe("unknown");
    expect(r.repo).toBeNull();
  });

  it("returns unknown for null/empty repoUrl", () => {
    expect(resolveSkillRepoVisibility(null, lookup).visibility).toBe("unknown");
    expect(resolveSkillRepoVisibility(undefined, lookup).visibility).toBe(
      "unknown",
    );
  });

  it("is case-insensitive on owner/name", () => {
    const r = resolveSkillRepoVisibility(
      "https://github.com/ANTON-abyzov/PRIVATE-stuff",
      lookup,
    );
    expect(r.visibility).toBe("private");
  });
});
