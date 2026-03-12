import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock getDefaultBranch (GitHub tree discovery)
// ---------------------------------------------------------------------------
const mockGetDefaultBranch = vi.hoisted(() => vi.fn());
vi.mock("../discovery/github-tree.js", () => ({
  getDefaultBranch: mockGetDefaultBranch,
}));

// ---------------------------------------------------------------------------
// Mock getSkill (registry)
// ---------------------------------------------------------------------------
const mockGetSkill = vi.hoisted(() => vi.fn());
vi.mock("../api/client.js", () => ({
  getSkill: mockGetSkill,
}));

// ---------------------------------------------------------------------------
// Mock marketplace helpers
// ---------------------------------------------------------------------------
const mockGetPluginSource = vi.hoisted(() => vi.fn());
const mockGetPluginVersion = vi.hoisted(() => vi.fn());
vi.mock("../marketplace/index.js", () => ({
  getPluginSource: mockGetPluginSource,
  getPluginVersion: mockGetPluginVersion,
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

import { fetchFromSource } from "./source-fetcher.js";
import type { ParsedSource } from "../resolvers/source-resolver.js";

const MOCK_LOCK_ENTRY = {
  version: "1.0.0",
  sha: "oldsha12345",
  tier: "VERIFIED",
  installedAt: "2026-01-01T00:00:00Z",
  source: "github:test/repo",
};

function mockFetchOk(text: string) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

function mockFetchNotFound() {
  return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
}

describe("fetchFromSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefaultBranch.mockResolvedValue("main");
  });

  // ---- registry -------------------------------------------------------

  it("delegates to getSkill for registry source", async () => {
    const parsed: ParsedSource = { type: "registry", skillName: "architect" };
    mockGetSkill.mockResolvedValue({
      content: "# Registry skill",
      version: "2.0.0",
      sha: "abc123",
      tier: "VERIFIED",
    });

    const result = await fetchFromSource(parsed, "architect", MOCK_LOCK_ENTRY);

    expect(mockGetSkill).toHaveBeenCalledWith("architect");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("# Registry skill");
    expect(result!.version).toBe("2.0.0");
  });

  it("returns null when registry fetch fails", async () => {
    const parsed: ParsedSource = { type: "registry", skillName: "missing" };
    mockGetSkill.mockRejectedValue(new Error("not found"));

    const result = await fetchFromSource(parsed, "missing", MOCK_LOCK_ENTRY);
    expect(result).toBeNull();
  });

  // ---- github (flat) --------------------------------------------------

  it("fetches SKILL.md from raw.githubusercontent.com for github source", async () => {
    const parsed: ParsedSource = { type: "github", owner: "foo", repo: "bar" };
    mockFetch.mockResolvedValue(mockFetchOk("# GitHub flat skill"));

    const result = await fetchFromSource(parsed, "myskill", MOCK_LOCK_ENTRY);

    expect(mockGetDefaultBranch).toHaveBeenCalledWith("foo", "bar");
    expect(mockFetch).toHaveBeenCalled();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("raw.githubusercontent.com/foo/bar/main");
    expect(result).not.toBeNull();
    expect(result!.content).toBe("# GitHub flat skill");
  });

  it("falls back to root SKILL.md when skills/{name}/SKILL.md returns 404", async () => {
    const parsed: ParsedSource = { type: "github", owner: "foo", repo: "bar" };
    mockFetch
      .mockResolvedValueOnce(mockFetchNotFound())   // skills/myskill/SKILL.md
      .mockResolvedValueOnce(mockFetchOk("# Root skill")); // SKILL.md

    const result = await fetchFromSource(parsed, "myskill", MOCK_LOCK_ENTRY);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result!.content).toBe("# Root skill");
  });

  it("returns null when both github fetch attempts fail", async () => {
    const parsed: ParsedSource = { type: "github", owner: "foo", repo: "bar" };
    mockFetch.mockResolvedValue(mockFetchNotFound());

    const result = await fetchFromSource(parsed, "myskill", MOCK_LOCK_ENTRY);
    expect(result).toBeNull();
  });

  // ---- github-plugin --------------------------------------------------

  it("fetches plugin skills via marketplace.json for github-plugin source", async () => {
    const parsed: ParsedSource = {
      type: "github-plugin",
      owner: "org",
      repo: "repo",
      pluginName: "frontend",
    };
    const marketplaceJson = JSON.stringify({
      name: "repo",
      owner: { name: "org" },
      plugins: [{ name: "frontend", source: "./plugins/frontend", version: "1.2.3" }],
    });

    // marketplace.json fetch
    mockFetch.mockResolvedValueOnce(mockFetchOk(marketplaceJson));
    // Trees API for plugin skills
    mockFetch.mockResolvedValueOnce(
      mockFetchOk(
        JSON.stringify({
          tree: [
            { path: "plugins/frontend/skills/nextjs/SKILL.md", type: "blob" },
            { path: "plugins/frontend/skills/react/SKILL.md", type: "blob" },
          ],
        }),
      ),
    );
    // Individual skill fetches
    mockFetch.mockResolvedValueOnce(mockFetchOk("# nextjs skill"));
    mockFetch.mockResolvedValueOnce(mockFetchOk("# react skill"));

    mockGetPluginSource.mockReturnValue("./plugins/frontend");
    mockGetPluginVersion.mockReturnValue("1.2.3");

    const result = await fetchFromSource(parsed, "frontend", {
      ...MOCK_LOCK_ENTRY,
      pluginDir: true,
    });

    expect(result).not.toBeNull();
    expect(result!.version).toBe("1.2.3");
    // Content should contain both skills
    expect(result!.content).toContain("# nextjs skill");
    expect(result!.content).toContain("# react skill");
  });

  it("returns null when marketplace.json fetch fails for github-plugin", async () => {
    const parsed: ParsedSource = {
      type: "github-plugin",
      owner: "org",
      repo: "repo",
      pluginName: "frontend",
    };
    mockFetch.mockResolvedValue(mockFetchNotFound());

    const result = await fetchFromSource(parsed, "frontend", MOCK_LOCK_ENTRY);
    expect(result).toBeNull();
  });

  // ---- marketplace ----------------------------------------------------

  it("handles marketplace source same as github-plugin", async () => {
    const parsed: ParsedSource = {
      type: "marketplace",
      owner: "org",
      repo: "repo",
      pluginName: "sw",
    };
    const marketplaceJson = JSON.stringify({
      name: "repo",
      owner: { name: "org" },
      plugins: [{ name: "sw", source: "./plugins/sw", version: "3.0.0" }],
    });

    mockFetch.mockResolvedValueOnce(mockFetchOk(marketplaceJson));
    mockFetch.mockResolvedValueOnce(
      mockFetchOk(
        JSON.stringify({
          tree: [{ path: "plugins/sw/skills/commands/SKILL.md", type: "blob" }],
        }),
      ),
    );
    mockFetch.mockResolvedValueOnce(mockFetchOk("# sw commands skill"));

    mockGetPluginSource.mockReturnValue("./plugins/sw");
    mockGetPluginVersion.mockReturnValue("3.0.0");

    const result = await fetchFromSource(parsed, "sw", {
      ...MOCK_LOCK_ENTRY,
      pluginDir: true,
    });

    expect(result).not.toBeNull();
    expect(result!.version).toBe("3.0.0");
  });

  // ---- local ----------------------------------------------------------

  it("returns null for local source (skip with no fetch)", async () => {
    const parsed: ParsedSource = { type: "local", baseName: "specweave" };

    const result = await fetchFromSource(parsed, "sw", MOCK_LOCK_ENTRY);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSkill).not.toHaveBeenCalled();
  });

  // ---- unknown --------------------------------------------------------

  it("returns null for unknown source type", async () => {
    const parsed: ParsedSource = { type: "unknown", raw: "garbage" };

    const result = await fetchFromSource(parsed, "skill", MOCK_LOCK_ENTRY);
    expect(result).toBeNull();
  });
});
