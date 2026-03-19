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
// Mock core-skills/sync (findCoreSkillsDir, listCoreSkills)
// ---------------------------------------------------------------------------
const mockFindCoreSkillsDir = vi.hoisted(() => vi.fn());
const mockListCoreSkills = vi.hoisted(() => vi.fn());
vi.mock("../core-skills/sync.js", () => ({
  findCoreSkillsDir: mockFindCoreSkillsDir,
  listCoreSkills: mockListCoreSkills,
}));

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------
const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", mockFetch);

import { fetchFromSource, normalizeContent, computeSha } from "./source-fetcher.js";
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

  it("returns file map from local plugin cache for local source", async () => {
    const parsed: ParsedSource = { type: "local", baseName: "specweave" };
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    // Create temp skill directory with real files
    const tmpSkillsDir = join(tmpdir(), `vskill-test-${Date.now()}`);
    mkdirSync(join(tmpSkillsDir, "pm"), { recursive: true });
    mkdirSync(join(tmpSkillsDir, "architect"), { recursive: true });
    writeFileSync(join(tmpSkillsDir, "pm", "SKILL.md"), "# PM Skill", "utf-8");
    writeFileSync(join(tmpSkillsDir, "architect", "SKILL.md"), "# Architect Skill", "utf-8");

    mockFindCoreSkillsDir.mockReturnValue(tmpSkillsDir);
    mockListCoreSkills.mockReturnValue(["pm", "architect"]);

    const result = await fetchFromSource(parsed, "sw", MOCK_LOCK_ENTRY);

    expect(result).not.toBeNull();
    expect(result!.files).toBeDefined();
    expect(result!.files!["pm/SKILL.md"]).toBe("# PM Skill");
    expect(result!.files!["architect/SKILL.md"]).toBe("# Architect Skill");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetSkill).not.toHaveBeenCalled();

    // Cleanup
    rmSync(tmpSkillsDir, { recursive: true, force: true });
  });

  it("returns null for local source when no plugin cache exists", async () => {
    const parsed: ParsedSource = { type: "local", baseName: "specweave" };
    mockFindCoreSkillsDir.mockReturnValue(null);

    const result = await fetchFromSource(parsed, "sw", MOCK_LOCK_ENTRY);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ---- unknown --------------------------------------------------------

  it("returns null for unknown source type", async () => {
    const parsed: ParsedSource = { type: "unknown", raw: "garbage" };

    const result = await fetchFromSource(parsed, "skill", MOCK_LOCK_ENTRY);
    expect(result).toBeNull();
  });

  // ---- sha is 64-char hex in all fetch results -----------------------

  it("returns 64-char hex sha from registry fetch", async () => {
    const parsed: ParsedSource = { type: "registry", skillName: "architect" };
    mockGetSkill.mockResolvedValue({
      content: "# Registry skill",
      version: "2.0.0",
      sha: "abc123",
      tier: "VERIFIED",
    });

    const result = await fetchFromSource(parsed, "architect", MOCK_LOCK_ENTRY);

    expect(result).not.toBeNull();
    expect(result!.sha).toHaveLength(64);
    expect(result!.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 64-char hex sha from github flat fetch", async () => {
    const parsed: ParsedSource = { type: "github", owner: "foo", repo: "bar" };
    mockFetch.mockResolvedValue(mockFetchOk("# GitHub flat skill"));

    const result = await fetchFromSource(parsed, "myskill", MOCK_LOCK_ENTRY);

    expect(result).not.toBeNull();
    expect(result!.sha).toHaveLength(64);
    expect(result!.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 64-char hex sha from plugin fetch", async () => {
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

    mockFetch.mockResolvedValueOnce(mockFetchOk(marketplaceJson));
    mockFetch.mockResolvedValueOnce(
      mockFetchOk(
        JSON.stringify({
          tree: [
            { path: "plugins/frontend/skills/nextjs/SKILL.md", type: "blob" },
          ],
        }),
      ),
    );
    mockFetch.mockResolvedValueOnce(mockFetchOk("# nextjs skill"));

    mockGetPluginSource.mockReturnValue("./plugins/frontend");
    mockGetPluginVersion.mockReturnValue("1.2.3");

    const result = await fetchFromSource(parsed, "frontend", {
      ...MOCK_LOCK_ENTRY,
      pluginDir: true,
    });

    expect(result).not.toBeNull();
    expect(result!.sha).toHaveLength(64);
    expect(result!.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  // ---- FetchResult.files population -----------------------------------

  it("populates files map in registry fetch result", async () => {
    const parsed: ParsedSource = { type: "registry", skillName: "architect" };
    mockGetSkill.mockResolvedValue({
      content: "# Registry skill",
      version: "2.0.0",
      sha: "abc123",
      tier: "VERIFIED",
    });

    const result = await fetchFromSource(parsed, "architect", MOCK_LOCK_ENTRY);

    expect(result).not.toBeNull();
    expect(result!.files).toEqual({ "SKILL.md": "# Registry skill" });
  });

  it("populates files map in github flat fetch result", async () => {
    const parsed: ParsedSource = { type: "github", owner: "foo", repo: "bar" };
    mockFetch.mockResolvedValue(mockFetchOk("# GitHub flat skill"));

    const result = await fetchFromSource(parsed, "myskill", MOCK_LOCK_ENTRY);

    expect(result).not.toBeNull();
    expect(result!.files).toEqual({ "SKILL.md": "# GitHub flat skill" });
  });

  it("populates files map in plugin fetch result", async () => {
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

    mockFetch.mockResolvedValueOnce(mockFetchOk(marketplaceJson));
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
    mockFetch.mockResolvedValueOnce(mockFetchOk("# nextjs skill"));
    mockFetch.mockResolvedValueOnce(mockFetchOk("# react skill"));

    mockGetPluginSource.mockReturnValue("./plugins/frontend");
    mockGetPluginVersion.mockReturnValue("1.2.3");

    const result = await fetchFromSource(parsed, "frontend", {
      ...MOCK_LOCK_ENTRY,
      pluginDir: true,
    });

    expect(result).not.toBeNull();
    expect(result!.files).toBeDefined();
    expect(result!.files!["plugins/frontend/skills/nextjs/SKILL.md"]).toBe("# nextjs skill");
    expect(result!.files!["plugins/frontend/skills/react/SKILL.md"]).toBe("# react skill");
  });
});

// ---------------------------------------------------------------------------
// normalizeContent
// ---------------------------------------------------------------------------
describe("normalizeContent", () => {
  it("strips UTF-8 BOM prefix", () => {
    expect(normalizeContent("\uFEFFhello")).toBe("hello");
  });

  it("normalizes CRLF to LF", () => {
    expect(normalizeContent("line1\r\nline2\r\n")).toBe("line1\nline2\n");
  });

  it("strips BOM and normalizes CRLF together", () => {
    expect(normalizeContent("\uFEFFa\r\nb")).toBe("a\nb");
  });

  it("passes through clean content unchanged", () => {
    expect(normalizeContent("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(normalizeContent("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// computeSha
// ---------------------------------------------------------------------------
describe("computeSha", () => {
  // ---- single-string overload ------------------------------------------

  it("returns full 64-char hex for single string", () => {
    const sha = computeSha("hello world");
    expect(sha).toHaveLength(64);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(sha).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("normalizes CRLF before hashing single string", () => {
    const withCrlf = computeSha("hello\r\nworld");
    const withLf = computeSha("hello\nworld");
    expect(withCrlf).toBe(withLf);
  });

  it("strips BOM before hashing single string", () => {
    const withBom = computeSha("\uFEFFhello");
    const without = computeSha("hello");
    expect(withBom).toBe(without);
  });

  // ---- multi-file overload ---------------------------------------------

  it("returns full 64-char hex for multi-file input", () => {
    const sha = computeSha({ "a.md": "alpha", "b.md": "beta" });
    expect(sha).toHaveLength(64);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    expect(sha).toBe("7c499b4d26d8ad8ab87252aa7657af21a0512c1ea7c7b2da50f5b4c69c036c5f");
  });

  it("sorts keys by path (case-sensitive ascending) for deterministic hash", () => {
    const hash1 = computeSha({ "b.md": "beta", "a.md": "alpha" });
    const hash2 = computeSha({ "a.md": "alpha", "b.md": "beta" });
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different file contents", () => {
    const hash1 = computeSha({ "a.md": "alpha" });
    const hash2 = computeSha({ "a.md": "changed" });
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different file paths", () => {
    const hash1 = computeSha({ "a.md": "content" });
    const hash2 = computeSha({ "b.md": "content" });
    expect(hash1).not.toBe(hash2);
  });

  it("normalizes CRLF in multi-file content before hashing", () => {
    const withCrlf = computeSha({ "a.md": "line1\r\nline2" });
    const withLf = computeSha({ "a.md": "line1\nline2" });
    expect(withCrlf).toBe(withLf);
  });

  it("strips BOM in multi-file content before hashing", () => {
    const withBom = computeSha({ "a.md": "\uFEFFcontent" });
    const without = computeSha({ "a.md": "content" });
    expect(withBom).toBe(without);
  });
});
