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
        { name: "test-skill", author: "test", repoUrl: "https://github.com/test/test-skill", tier: "VERIFIED", score: 90, installs: 1250, githubStars: 1300 },
      ],
      hasMore: false,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
  });

  it("TC-030: non-TTY output includes tab-separated result with stars", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: false, noHint: false });
    const output = logs.join("\n");
    expect(output).toContain("test/test-skill/test-skill");
    expect(output).toContain("1300");
  });

  it("TC-031: hint is suppressed with --json flag", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: true, noHint: false });
    const output = logs.join("\n");
    expect(output).not.toContain("Install:");
  });

  it("TC-032: hint is suppressed with --no-hint flag", async () => {
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

  it("sorts results by stars descending", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "low-stars", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 10, githubStars: 10 },
        { name: "high-stars", author: "b", repoUrl: "https://github.com/b/c", tier: "VERIFIED", score: 50, installs: 5000, githubStars: 5000 },
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
        { name: "skill-1", author: "a", repoUrl: "https://github.com/a/b", tier: "VERIFIED", score: 90, installs: 100, githubStars: 100 },
      ],
      hasMore: true,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("Use --limit");
  });

  it("shows blocked skills with threat info", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    mockSearchSkills.mockResolvedValue({
      results: [
        { name: "bad-skill", author: "evil", repoUrl: "https://github.com/evil/bad", tier: "BLOCKED", score: 0, installs: 0, githubStars: 0, isBlocked: true, threatType: "credential-theft", severity: "critical" },
      ],
      hasMore: false,
    });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("credential-theft");
  });

  it("JSON output includes stars field", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    await findCommand("test", { json: true });
    const jsonLine = logs.find((l) => l.trimStart().startsWith("["));
    expect(jsonLine).toBeDefined();
    const parsed = JSON.parse(jsonLine!);
    expect(parsed[0].stars).toBe(1300);
  });

  it("skill URL uses flat name, not owner/repo/skill", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    await findCommand("test");
    const output = logs.join("\n");
    expect(output).toContain("verified-skill.com/skills/test-skill");
    expect(output).not.toContain("verified-skill.com/skills/test%2Ftest-skill%2Ftest-skill");
  });
});
