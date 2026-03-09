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
    expect(output).toContain("test-skill\ttest/test-skill\t1300");
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

  it("displays GitHub stars in TTY mode", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("\u2605 1.3K");
    expect(output).toContain("test/test-skill/test-skill");
  });

  it("sorts results by githubStars descending", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "low-stars", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 10, githubStars: 10, vskillInstalls: 10 },
        { name: "high-stars", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 50, installs: 5000, githubStars: 5000, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const highIdx = output.indexOf("high-stars");
    const lowIdx = output.indexOf("low-stars");
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("uses relevance score as tiebreaker for equal stars", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "low-score", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 30, installs: 100, githubStars: 10, vskillInstalls: 100 },
        { name: "high-score", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 90, installs: 100, githubStars: 10, vskillInstalls: 100 },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    const highIdx = output.indexOf("high-score");
    const lowIdx = output.indexOf("low-score");
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
    expect(output).toContain("Use --limit N for more");
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
    expect(output).toContain("\u2605 1.2K");
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
    expect(dataLines[0]).toBe("my-skill\towner/repo\t10\t\t\t");
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
    expect(dataLines[0]).toBe("my-skill\towner/repo\t10\tT3\t\t");
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

  it("displays maybe badge for T2 trust tier", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "basic-skill", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 40, installs: 100, githubStars: 10, vskillInstalls: 100, trustTier: "T2" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("? maybe");
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
    expect(output).not.toContain("? maybe");
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
