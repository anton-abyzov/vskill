import { describe, it, expect, vi } from "vitest";

// Mock output utilities — strip ANSI for easier assertion
vi.mock("./output.js", () => ({
  bold: (s: string) => s,
  green: (s: string) => s,
  red: (s: string) => s,
  yellow: (s: string) => s,
  dim: (s: string) => s,
  cyan: (s: string) => s,
  link: (_href: string, text: string) => text,
  formatInstalls: (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
    return String(n);
  },
}));

import {
  extractBaseRepo,
  formatSkillId,
  getSkillUrl,
  getTrustBadge,
  rankSearchResults,
  formatResultLine,
} from "./skill-display.js";

import type { SkillSearchResult } from "../api/client.js";

function makeResult(overrides: Partial<SkillSearchResult> = {}): SkillSearchResult {
  return {
    name: "test-skill",
    author: "test",
    repoUrl: "https://github.com/owner/repo",
    tier: "VERIFIED",
    score: 90,
    description: "A test skill",
    installs: 100,
    githubStars: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractBaseRepo
// ---------------------------------------------------------------------------

describe("extractBaseRepo", () => {
  it("extracts owner/repo from github URL", () => {
    expect(extractBaseRepo("https://github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("strips /tree/main from URL", () => {
    expect(extractBaseRepo("https://github.com/owner/repo/tree/main")).toBe("owner/repo");
  });

  it("returns null for undefined", () => {
    expect(extractBaseRepo(undefined)).toBeNull();
  });

  it("handles plain github URL without suffix", () => {
    expect(extractBaseRepo("https://github.com/owner/repo")).toBe("owner/repo");
  });
});

// ---------------------------------------------------------------------------
// formatSkillId
// ---------------------------------------------------------------------------

describe("formatSkillId", () => {
  it("formats with slug fields", () => {
    const r = makeResult({ ownerSlug: "acme", repoSlug: "tools", skillSlug: "linter" });
    expect(formatSkillId(r)).toBe("acme/tools/linter");
  });

  it("falls back to repoUrl and name when no slugs", () => {
    const r = makeResult({ name: "my-skill", repoUrl: "https://github.com/owner/repo" });
    expect(formatSkillId(r)).toBe("owner/repo/my-skill");
  });

  it("uses just name when no slugs and no repoUrl", () => {
    const r = makeResult({ name: "orphan-skill", repoUrl: undefined });
    expect(formatSkillId(r)).toBe("orphan-skill");
  });
});

// ---------------------------------------------------------------------------
// getSkillUrl
// ---------------------------------------------------------------------------

describe("getSkillUrl", () => {
  it("uses slug fields when all present", () => {
    const r = makeResult({ ownerSlug: "acme", repoSlug: "tools", skillSlug: "linter" });
    expect(getSkillUrl(r)).toBe("https://verified-skill.com/skills/acme/tools/linter");
  });

  it("derives from 3-part name", () => {
    const r = makeResult({ name: "acme/tools/linter" });
    expect(getSkillUrl(r)).toBe("https://verified-skill.com/skills/acme/tools/linter");
  });

  it("falls back to repoUrl + name", () => {
    const r = makeResult({ name: "linter", repoUrl: "https://github.com/acme/tools" });
    expect(getSkillUrl(r)).toBe("https://verified-skill.com/skills/acme/tools/linter");
  });

  it("uses flat name as last resort", () => {
    const r = makeResult({ name: "linter", repoUrl: undefined });
    expect(getSkillUrl(r)).toBe("https://verified-skill.com/skills/linter");
  });
});

// ---------------------------------------------------------------------------
// getTrustBadge
// ---------------------------------------------------------------------------

describe("getTrustBadge", () => {
  it("returns certified badge for CERTIFIED certTier", () => {
    expect(getTrustBadge("CERTIFIED", undefined)).toContain("certified");
  });

  it("returns verified badge for VERIFIED certTier", () => {
    expect(getTrustBadge("VERIFIED", undefined)).toContain("verified");
  });

  it("prefers certTier over trustTier", () => {
    const badge = getTrustBadge("CERTIFIED", "T2");
    expect(badge).toContain("certified");
    expect(badge).not.toContain("pending");
  });

  it("falls back to trustTier T4", () => {
    expect(getTrustBadge(undefined, "T4")).toContain("certified");
  });

  it("falls back to trustTier T3", () => {
    expect(getTrustBadge(undefined, "T3")).toContain("verified");
  });

  it("falls back to trustTier T2", () => {
    expect(getTrustBadge(undefined, "T2")).toContain("pending");
  });

  it("falls back to trustTier T1", () => {
    expect(getTrustBadge(undefined, "T1")).toContain("pending");
  });

  it("returns empty string for unknown", () => {
    expect(getTrustBadge(undefined, undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// rankSearchResults
// ---------------------------------------------------------------------------

describe("rankSearchResults", () => {
  it("sorts blocked results to end", () => {
    const results = [
      makeResult({ name: "blocked-skill", isBlocked: true, score: 100 }),
      makeResult({ name: "good-skill", isBlocked: false, score: 50 }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked[0].name).toBe("good-skill");
    expect(ranked[1].name).toBe("blocked-skill");
  });

  it("promotes exact skillSlug match to first position", () => {
    const results = [
      makeResult({ name: "other", skillSlug: "other", certTier: "CERTIFIED", githubStars: 1000 }),
      makeResult({ name: "skill-creator", skillSlug: "skill-creator", githubStars: 10 }),
    ];
    const ranked = rankSearchResults(results, "skill-creator");
    expect(ranked[0].skillSlug).toBe("skill-creator");
  });

  it("exact match promotion is case-insensitive", () => {
    const results = [
      makeResult({ name: "other", skillSlug: "other", certTier: "CERTIFIED", githubStars: 1000 }),
      makeResult({ name: "Skill-Creator", skillSlug: "skill-creator", githubStars: 10 }),
    ];
    const ranked = rankSearchResults(results, "Skill-Creator");
    expect(ranked[0].skillSlug).toBe("skill-creator");
  });

  it("sorts by cert tier: CERTIFIED > VERIFIED > other", () => {
    const results = [
      makeResult({ name: "unranked", certTier: undefined, githubStars: 100 }),
      makeResult({ name: "verified", certTier: "VERIFIED", githubStars: 100 }),
      makeResult({ name: "certified", certTier: "CERTIFIED", githubStars: 100 }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked[0].name).toBe("certified");
    expect(ranked[1].name).toBe("verified");
    expect(ranked[2].name).toBe("unranked");
  });

  it("uses stars as tiebreaker within same cert tier", () => {
    const results = [
      makeResult({ name: "low-stars", certTier: "VERIFIED", githubStars: 10 }),
      makeResult({ name: "high-stars", certTier: "VERIFIED", githubStars: 1000 }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked[0].name).toBe("high-stars");
    expect(ranked[1].name).toBe("low-stars");
  });

  it("uses score as tiebreaker when cert tier and stars equal", () => {
    const results = [
      makeResult({ name: "low-score", certTier: "VERIFIED", githubStars: 100, score: 30 }),
      makeResult({ name: "high-score", certTier: "VERIFIED", githubStars: 100, score: 90 }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked[0].name).toBe("high-score");
    expect(ranked[1].name).toBe("low-score");
  });

  it("all blocked results preserve sort order within blocked group", () => {
    const results = [
      makeResult({ name: "b1", isBlocked: true, certTier: "CERTIFIED", githubStars: 10 }),
      makeResult({ name: "b2", isBlocked: true, certTier: "VERIFIED", githubStars: 1000 }),
    ];
    const ranked = rankSearchResults(results);
    // Both blocked, so cert tier sort still applies within blocked group
    expect(ranked[0].name).toBe("b1");
    expect(ranked[1].name).toBe("b2");
  });

  it("does not promote when no exactQuery provided", () => {
    const results = [
      makeResult({ name: "certified", skillSlug: "other", certTier: "CERTIFIED", githubStars: 1000 }),
      makeResult({ name: "match", skillSlug: "skill-creator", githubStars: 10 }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked[0].name).toBe("certified");
  });

  it("does not promote blocked exact match", () => {
    const results = [
      makeResult({ name: "good", skillSlug: "good", certTier: "VERIFIED", githubStars: 100 }),
      makeResult({ name: "match", skillSlug: "skill-creator", isBlocked: true, githubStars: 10 }),
    ];
    const ranked = rankSearchResults(results, "skill-creator");
    expect(ranked[0].name).toBe("good");
    expect(ranked[1].name).toBe("match");
  });

  it("handles empty results", () => {
    expect(rankSearchResults([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatResultLine
// ---------------------------------------------------------------------------

describe("formatResultLine", () => {
  it("includes skill ID, stars, badge, and URL for non-blocked result", () => {
    const r = makeResult({
      ownerSlug: "acme",
      repoSlug: "tools",
      skillSlug: "linter",
      githubStars: 42,
      certTier: "VERIFIED",
    });
    const line = formatResultLine(r);
    expect(line).toContain("acme/tools/linter");
    expect(line).toContain("42");
    expect(line).toContain("verified");
    expect(line).toContain("verified-skill.com");
  });

  it("shows BLOCKED label for blocked results", () => {
    const r = makeResult({
      isBlocked: true,
      threatType: "credential-theft",
      severity: "critical",
    });
    const line = formatResultLine(r);
    expect(line).toContain("BLOCKED");
    expect(line).toContain("critical | credential-theft");
  });

  it("shows plugin badge when pluginName is present", () => {
    const r = makeResult({ pluginName: "specweave-release" });
    const line = formatResultLine(r);
    expect(line).toContain("[specweave-release]");
  });
});

// ---------------------------------------------------------------------------
// Edge cases for ranking (T-006)
// ---------------------------------------------------------------------------

describe("rankSearchResults edge cases", () => {
  it("results with missing slug fields are still ranked but not installable", () => {
    const results = [
      makeResult({ name: "no-slugs", ownerSlug: undefined, repoSlug: undefined, skillSlug: undefined }),
      makeResult({ name: "has-slugs", ownerSlug: "a", repoSlug: "b", skillSlug: "c" }),
    ];
    const ranked = rankSearchResults(results);
    // Both appear in results (ranking doesn't filter)
    expect(ranked).toHaveLength(2);
    // Installable filtering is done by the caller, not by rank
  });

  it("single blocked result is still returned", () => {
    const results = [
      makeResult({ name: "blocked", isBlocked: true }),
    ];
    const ranked = rankSearchResults(results);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].isBlocked).toBe(true);
  });
});
