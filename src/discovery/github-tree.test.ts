import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import { discoverSkills } from "./github-tree.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTreeResponse(paths: string[]) {
  return {
    tree: paths.map((path) => ({
      path,
      mode: "100644",
      type: "blob" as const,
      sha: "abc123",
      size: 100,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverSkills", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // TC-001: Discovers root SKILL.md and skills/*/SKILL.md
  it("discovers root SKILL.md and skills/*/SKILL.md from tree response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeTreeResponse([
          "README.md",
          "SKILL.md",
          "skills/foo/SKILL.md",
          "skills/bar/SKILL.md",
          "src/index.ts",
        ]),
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          name: "repo",
          path: "SKILL.md",
          rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
        },
        {
          name: "foo",
          path: "skills/foo/SKILL.md",
          rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/foo/SKILL.md",
        },
        {
          name: "bar",
          path: "skills/bar/SKILL.md",
          rawUrl: "https://raw.githubusercontent.com/owner/repo/main/skills/bar/SKILL.md",
        },
      ])
    );
  });

  // TC-002: Returns only root SKILL.md when no skills/ directory
  it("returns only root SKILL.md when no skills/ directory exists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeTreeResponse(["SKILL.md", "README.md", "package.json"]),
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "repo",
      path: "SKILL.md",
      rawUrl: "https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
    });
  });

  // TC-003: Returns empty array when no SKILL.md files found
  it("returns empty array when no SKILL.md files found", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeTreeResponse(["README.md", "package.json", "src/index.ts"]),
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(result).toEqual([]);
  });

  // TC-004: Returns empty array on API error (404, rate-limited)
  it("returns empty array on 404", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");
    expect(result).toEqual([]);
  });

  it("returns empty array on 403 (rate limited)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");
    expect(result).toEqual([]);
  });

  it("returns empty array on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("Network error")
    ) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");
    expect(result).toEqual([]);
  });

  // TC-005: Ignores SKILL.md in nested non-skill directories
  it("ignores SKILL.md in nested non-skill directories", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makeTreeResponse([
          "SKILL.md",
          "docs/SKILL.md",
          "examples/SKILL.md",
          "node_modules/SKILL.md",
          "skills/foo/SKILL.md",
          "skills/bar/nested/SKILL.md",
        ]),
    }) as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("repo");
    expect(names).toContain("foo");
    // Should NOT contain docs, examples, node_modules, or deeply nested skills
    expect(names).not.toContain("docs");
    expect(names).not.toContain("examples");
    expect(names).not.toContain("nested");
  });

  // Calls correct GitHub Trees API URL
  it("calls the GitHub Trees API with correct URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTreeResponse(["SKILL.md"]),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await discoverSkills("anthropics", "frontend-design");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/anthropics/frontend-design/git/trees/main?recursive=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github.v3+json",
        }),
      })
    );
  });
});
