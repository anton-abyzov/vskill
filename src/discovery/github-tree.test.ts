import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import { discoverSkills, extractDescription, getDefaultBranch, _resetBranchCache } from "./github-tree.js";

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

function makeBranchResponse(branch = "main") {
  return { ok: true, json: async () => ({ default_branch: branch }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverSkills", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetBranchCache();
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

  // TC-021: discoverSkills populates descriptions from fetched content
  it("populates description field from SKILL.md content", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBranchResponse("main"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeTreeResponse(["skills/foo/SKILL.md", "skills/bar/SKILL.md"]),
      })
      .mockResolvedValue({
        ok: true,
        text: async () => "# Foo Skill\n\nThis skill does X",
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(result).toHaveLength(2);
    // At least one skill should have a description populated
    const hasDescription = result.some((s) => s.description !== undefined);
    expect(hasDescription).toBe(true);
  });

  // Calls correct GitHub Trees API URL
  it("calls the GitHub Trees API with correct URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTreeResponse(["SKILL.md"]),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await discoverSkills("anthropics", "frontend-design");

    // First call is getDefaultBranch, second is the tree API
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/anthropics/frontend-design/git/trees/main?recursive=1",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github.v3+json",
        }),
      })
    );
  });

  // Uses the repo's actual default branch (e.g. master)
  it("uses repo default branch instead of hardcoded main", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeBranchResponse("master"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeTreeResponse(["SKILL.md"]),
      });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const result = await discoverSkills("owner", "repo");

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/owner/repo/git/trees/master?recursive=1",
      expect.anything()
    );
    expect(result[0].rawUrl).toBe(
      "https://raw.githubusercontent.com/owner/repo/master/SKILL.md"
    );
  });
});

describe("extractDescription", () => {
  it("returns first non-heading, non-empty line as description", () => {
    const content = "# Title\n\nThis skill does X\n\nMore content";
    expect(extractDescription(content)).toBe("This skill does X");
  });

  it("truncates description at 80 chars with ellipsis", () => {
    const longLine = "A".repeat(120);
    const content = `# Title\n\n${longLine}`;
    const result = extractDescription(content);
    expect(result).toBe("A".repeat(77) + "...");
    expect(result!.length).toBe(80);
  });

  it("skips YAML frontmatter delimiters", () => {
    const content = "---\ntitle: foo\n---\n# Title\nDescription here";
    expect(extractDescription(content)).toBe("Description here");
  });

  it("returns undefined when content has only headings", () => {
    const content = "# Title\n## Section\n### Subsection";
    expect(extractDescription(content)).toBeUndefined();
  });

  it("returns undefined for empty content", () => {
    expect(extractDescription("")).toBeUndefined();
  });

  it("skips blank lines before first content line", () => {
    const content = "\n\n# Title\n\n\nActual description";
    expect(extractDescription(content)).toBe("Actual description");
  });
});

describe("getDefaultBranch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetBranchCache();
  });

  it("returns default_branch from GitHub API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ default_branch: "develop" }),
    }) as unknown as typeof fetch;

    const branch = await getDefaultBranch("test-owner", "test-repo-1");
    expect(branch).toBe("develop");
  });

  it("falls back to main on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    const branch = await getDefaultBranch("test-owner", "test-repo-2");
    expect(branch).toBe("main");
  });

  it("falls back to main on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("Network error")
    ) as unknown as typeof fetch;

    const branch = await getDefaultBranch("test-owner", "test-repo-3");
    expect(branch).toBe("main");
  });

  it("caches results per owner/repo", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ default_branch: "master" }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const first = await getDefaultBranch("cached-owner", "cached-repo");
    const second = await getDefaultBranch("cached-owner", "cached-repo");

    expect(first).toBe("master");
    expect(second).toBe("master");
    // Only one fetch call — second was served from cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
