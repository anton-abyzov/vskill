// ---------------------------------------------------------------------------
// Tests for find command
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSearchSkills = vi.hoisted(() => vi.fn());

vi.mock("../api/client.js", () => ({
  searchSkills: mockSearchSkills,
}));

const logs: string[] = [];
let origIsTTY: boolean | undefined;

import { findCommand } from "./find.js";

describe("findCommand", () => {
  beforeEach(() => {
    logs.length = 0;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    origIsTTY = process.stdout.isTTY;
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "test-skill", author: "test", repoUrl: "https://github.com/test/test-skill", tier: "VERIFIED", score: 90, installs: 1250, githubStars: 1300, vskillInstalls: 1250 },
      ],
      hasMore: false,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("non-TTY output includes tab-separated result with stars", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: false, noHint: false });
    const output = logs.join("\n");
    expect(output).toContain("test-skill\ttest/test-skill\t\t1300");
    // Install hint should show full skill path, not just repo
    expect(output).toContain("Install: npx vskill i test/test-skill/test-skill");
    expect(output).toContain("More from this repo: npx vskill i test/test-skill");
  });

  it("hint is suppressed with --json flag", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: true, noHint: false });
    const output = logs.join("\n");
    expect(output).not.toContain("Install:");
  });

  it("hint is suppressed with --no-hint flag", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: false, noHint: true });
    const output = logs.join("\n");
    expect(output).not.toContain("Install:");
  });

  it("TTY install hint shows exact skill path with repo suggestion", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "scout", author: "anton", repoUrl: "https://github.com/anton-abyzov/vskill", tier: "VERIFIED", score: 90, installs: 100, githubStars: 3, vskillInstalls: 100, ownerSlug: "anton-abyzov", repoSlug: "vskill", skillSlug: "scout" },
      ],
      hasMore: false,
    });
    await findCommand("anton-abyzov/vskill/scout");
    const output = logs.join("\n");
    expect(output).toContain("npx vskill i anton-abyzov/vskill/scout");
    expect(output).toContain("More from this repo: ");
    expect(output).toContain("npx vskill i anton-abyzov/vskill");
  });

  it("TTY output shows version when currentVersion is present", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "versioned-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100, currentVersion: "2.3.1" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("v2.3.1");
  });

  it("non-TTY output includes currentVersion in tab-separated fields", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "versioned-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100, currentVersion: "1.2.0" },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toContain("1.2.0");
  });

  it("displays GitHub stars in TTY mode", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u26051.3K");
    expect(output).toContain("test/test-skill/test-skill");
  });

  it("sorts results by relevance score descending", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "low-score", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 50, installs: 5000, githubStars: 5000, vskillInstalls: 100 },
        { name: "high-score", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 90, installs: 10, githubStars: 10, vskillInstalls: 10 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const highIdx = output.indexOf("high-score");
    const lowIdx = output.indexOf("low-score");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("uses githubStars as tiebreaker for equal scores", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "low-stars", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
        { name: "high-stars", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 90, installs: 100, githubStars: 5000, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const highIdx = output.indexOf("high-stars");
    const lowIdx = output.indexOf("low-stars");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("shows --limit hint when truncated", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "skill-1", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 100, vskillInstalls: 100 },
      ],
      hasMore: true,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("Use --limit N for more (up to 30)");
  });

  it("does not show --limit hint when hasMore is false", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "skill-1", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 100, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).not.toContain("Use --limit N for more");
  });

  it("shows blocked skills with BLOCKED label and threat info", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "bad-skill", author: "evil", repoUrl: "https://github.com/evil/bad", tier: "BLOCKED", score: 0, installs: 0, githubStars: 0, isBlocked: true, threatType: "credential-theft", severity: "critical", vskillInstalls: 0 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("BLOCKED");
    expect(output).toContain("critical | credential-theft");
  });

  it("renders owner/repo/skill-name format in TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("test/test-skill/test-skill");
  });

  it("renders GitHub stars in human format in TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "popular", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 1200, githubStars: 1200, vskillInstalls: 10 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u26051.2K");
  });

  it("JSON output includes vskillInstalls field", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "test-skill", author: "test", repoUrl: "https://github.com/test/repo", tier: "VERIFIED", score: 90, installs: 42, githubStars: 10, vskillInstalls: 42 },
      ],
      hasMore: false,
    });
    await findCommand("test", { json: true });
    const jsonLine = logs.find((l) => l.trimStart().startsWith("["));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed[0].vskillInstalls).toBe(42);
  });

  it("JSON output defaults vskillInstalls to 0 when undefined", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "test-skill", author: "test", tier: "VERIFIED", score: 90, installs: 0, githubStars: 0 },
      ],
      hasMore: false,
    });
    await findCommand("test", { json: true });
    const jsonLine = logs.find((l) => l.trimStart().startsWith("["));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed[0].vskillInstalls).toBe(0);
  });

  it("non-TTY output uses tab-separated name, repo, stars", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "my-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 500, githubStars: 10, vskillInstalls: 500 },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines.length).toBe(1);
    expect(dataLines[0]).toBe("my-skill\towner/repo\t\t10\t\t\t");
  });

  it("non-TTY output includes trustTier when present", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "my-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 500, githubStars: 10, vskillInstalls: 500, trustTier: "T3" },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toBe("my-skill\towner/repo\t\t10\tT3\t\t");
  });

  it("non-TTY output prefers certTier over trustTier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "my-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 500, githubStars: 10, vskillInstalls: 500, certTier: "VERIFIED", trustTier: "T2" },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toBe("my-skill\towner/repo\t\t10\tVERIFIED\t\t");
  });

  it("non-TTY blocked output uses BLOCKED as third column", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "bad-skill", author: "evil", repoUrl: "https://github.com/evil/bad", tier: "BLOCKED", score: 0, installs: 0, githubStars: 0, isBlocked: true, threatType: "credential-theft", severity: "critical", vskillInstalls: 0 },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines.length).toBe(1);
    expect(dataLines[0]).toBe("bad-skill\tevil/bad\tBLOCKED");
  });

  it("displays certified badge for T4 trust tier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "top-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "CERTIFIED", score: 95, installs: 100, githubStars: 10, vskillInstalls: 100, trustTier: "T4" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u2713 certified");
  });

  it("displays verified badge for T3 trust tier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "good-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 70, installs: 100, githubStars: 10, vskillInstalls: 100, trustTier: "T3" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u2713 verified");
  });

  it("displays pending badge for T2 trust tier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "basic-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 40, installs: 100, githubStars: 10, vskillInstalls: 100, trustTier: "T2" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("~ pending");
  });

  it("displays pending badge for T1 trust tier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "new-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 20, installs: 10, githubStars: 5, vskillInstalls: 10, trustTier: "T1" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("~ pending");
  });

  it("does not show trust badge for blocked skills", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "bad-skill", author: "evil", repoUrl: "https://github.com/evil/bad", tier: "BLOCKED", score: 0, installs: 0, githubStars: 0, isBlocked: true, threatType: "credential-theft", severity: "critical", vskillInstalls: 0, trustTier: "T0" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("BLOCKED");
    expect(output).not.toContain("\u2713 certified");
    expect(output).not.toContain("\u2713 verified");
    expect(output).not.toContain("~ pending");
  });

  it("skill URL uses hierarchical slug fields when available", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "test-skill", author: "test", repoUrl: "https://github.com/test/test-skill", tier: "VERIFIED", score: 90, installs: 1250, githubStars: 1300, vskillInstalls: 1250, ownerSlug: "test", repoSlug: "test-skill", skillSlug: "test-skill" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("verified-skill.com/skills/test/test-skill/test-skill");
  });

  it("skill URL derives owner/repo from repoUrl when slugs missing", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "legacy-skill", author: "test", repoUrl: "https://github.com/test/legacy", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("verified-skill.com/skills/test/legacy/legacy-skill");
  });

  it("TTY output shows alternate repos when present", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        {
          name: "anthropics/claude-code/frontend-design",
          author: "anthropics",
          repoUrl: "https://github.com/anthropics/claude-code",
          tier: "CERTIFIED",
          score: 95,
          installs: 0,
          githubStars: 1200,
          vskillInstalls: 0,
          trustTier: "T4",
          ownerSlug: "anthropics",
          repoSlug: "claude-code",
          skillSlug: "frontend-design",
          alternateRepos: [{ ownerSlug: "anthropics", repoSlug: "skills", repoUrl: "https://github.com/anthropics/skills" }],
        },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("also: anthropics/skills");
  });

  it("JSON output includes alternateRepos array", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        {
          name: "org/repo/skill",
          author: "org",
          repoUrl: "https://github.com/org/repo",
          tier: "VERIFIED",
          score: 90,
          installs: 0,
          githubStars: 100,
          vskillInstalls: 0,
          alternateRepos: [{ ownerSlug: "org", repoSlug: "other-repo", repoUrl: "https://github.com/org/other-repo" }],
        },
      ],
      hasMore: false,
    });
    await findCommand("test", { json: true });
    const jsonLine = logs.find((l) => l.trimStart().startsWith("["));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed[0].alternateRepos).toEqual([{ ownerSlug: "org", repoSlug: "other-repo", repoUrl: "https://github.com/org/other-repo" }]);
  });

  it("piped output appends alternate repos as tab-separated field", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        {
          name: "my-skill",
          author: "a",
          repoUrl: "https://github.com/owner/repo",
          tier: "VERIFIED",
          score: 90,
          installs: 0,
          githubStars: 10,
          vskillInstalls: 0,
          alternateRepos: [{ ownerSlug: "owner", repoSlug: "other", repoUrl: "https://github.com/owner/other" }],
        },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toContain("owner/other");
  });

  it("TTY mode with pluginName shows dim bracketed suffix", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "release-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100, pluginName: "specweave-release" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("[specweave-release]");
  });

  it("TTY mode without pluginName shows no bracketed suffix", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "plain-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).not.toMatch(/\[.*\]/);
  });

  it("piped mode with pluginName includes it as tab-separated field", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "release-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100, pluginName: "specweave-release" },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toBe("release-skill\towner/repo\t\t10\t\tspecweave-release\t");
  });

  it("piped mode without pluginName has no extra field", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "plain-skill", author: "a", repoUrl: "https://github.com/owner/repo", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test", { noHint: true });
    const dataLines = logs.filter((l) => l.includes("\t"));
    expect(dataLines[0]).toBe("plain-skill\towner/repo\t\t10\t\t\t");
  });

  it("certTier VERIFIED shows verified badge even when trustTier is T2", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "cert-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 40, installs: 100, githubStars: 10, vskillInstalls: 100, certTier: "VERIFIED", trustTier: "T2" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u2713 verified");
    expect(output).not.toContain("~ pending");
  });

  it("certTier CERTIFIED shows certified badge even when trustTier is T3", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "cert-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "CERTIFIED", score: 95, installs: 100, githubStars: 10, vskillInstalls: 100, certTier: "CERTIFIED", trustTier: "T3" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u2713 certified");
  });

  it("uses cert tier as tiebreaker: CERTIFIED before VERIFIED before unranked", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "unranked", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 5000, vskillInstalls: 100, trustTier: "T2" },
        { name: "verified-skill", author: "a", repoUrl: "https://github.com/a/c", tier: "VERIFIED", score: 90, installs: 100, githubStars: 3000, vskillInstalls: 100, certTier: "VERIFIED" },
        { name: "certified-skill", author: "a", repoUrl: "https://github.com/a/d", tier: "CERTIFIED", score: 90, installs: 100, githubStars: 100, vskillInstalls: 100, certTier: "CERTIFIED" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const certIdx = output.indexOf("certified-skill");
    const verIdx = output.indexOf("verified-skill");
    const unrIdx = output.indexOf("unranked");
    expect(certIdx).toBeLessThan(verIdx);
    expect(verIdx).toBeLessThan(unrIdx);
  });

  it("sorts blocked skills to the end", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "blocked-skill", author: "evil", repoUrl: "https://github.com/evil/bad", tier: "BLOCKED", score: 95, installs: 0, githubStars: 10000, isBlocked: true, threatType: "credential-theft", severity: "critical", vskillInstalls: 0 },
        { name: "clean-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 10, installs: 100, githubStars: 5, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const cleanIdx = output.indexOf("clean-skill");
    const blockedIdx = output.indexOf("blocked-skill");
    expect(cleanIdx).toBeLessThan(blockedIdx);
  });

  it("sorts by score over cert tier: high-score VERIFIED beats low-score CERTIFIED", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "certified-low", author: "a", repoUrl: "https://github.com/a/b", tier: "CERTIFIED", score: 30, installs: 100, githubStars: 5000, vskillInstalls: 100, certTier: "CERTIFIED" },
        { name: "verified-high", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 90, installs: 10, githubStars: 10, vskillInstalls: 10, certTier: "VERIFIED" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const highIdx = output.indexOf("verified-high");
    const lowIdx = output.indexOf("certified-low");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("treats missing score as 0 and sorts below scored results", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "no-score", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", installs: 100, githubStars: 5000, vskillInstalls: 100, certTier: "CERTIFIED" },
        { name: "has-score", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 50, installs: 10, githubStars: 10, vskillInstalls: 10 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const scoredIdx = output.indexOf("has-score");
    const unscoredIdx = output.indexOf("no-score");
    expect(scoredIdx).toBeLessThan(unscoredIdx);
  });

  it("no alternateRepos renders identically to current behavior", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "simple-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).not.toContain("also:");
  });
});
