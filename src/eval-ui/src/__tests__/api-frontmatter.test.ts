// ---------------------------------------------------------------------------
// T-025 (AC-US3-01, AC-US3-02, AC-US3-05, AC-US3-07): /api/skills response
// must carry SKILL.md frontmatter fields + filesystem stats alongside the
// existing scan data.
//
// Contract surfaced to Wave 2 detail-agent:
//   - description, version, category, author, license, homepage  : string | null
//   - tags, deps, mcpDeps                                         : string[] | null
//   - entryPoint                                                  : string | null
//   - lastModified                                                : string | null (ISO 8601)
//   - sizeBytes                                                   : number | null
//   - sourceAgent                                                 : string | null
//
// Every field MUST be JSON-stable: missing values are `null`, not `undefined`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";
import type { SkillInfo } from "../types";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

const baseRaw = {
  plugin: "obsidian-brain",
  skill: "graph-scan",
  dir: "/tmp/obsidian-brain/skills/graph-scan",
  hasEvals: true,
  hasBenchmark: false,
  evalCount: 0,
  assertionCount: 0,
  benchmarkStatus: "pending" as const,
  lastBenchmark: null,
  origin: "source" as const,
};

describe("T-025: api.getSkills() frontmatter + filesystem contract", () => {
  it("passes through all frontmatter fields when the server provides them", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseRaw,
          description: "Autonomous Obsidian vault management",
          version: "1.3.0",
          category: "productivity",
          author: "Anton Abyzov",
          license: "MIT",
          homepage: "https://verified-skill.com/obsidian-brain",
          tags: ["obsidian", "knowledge-base"],
          deps: ["another-skill"],
          mcpDeps: ["obsidian-mcp", "filesystem"],
          entryPoint: "SKILL.md",
          lastModified: "2026-03-15T10:20:30.000Z",
          sizeBytes: 4096,
          sourceAgent: null,
        },
      ]),
    );
    const [item] = await api.getSkills();
    expect(item.description).toBe("Autonomous Obsidian vault management");
    expect(item.version).toBe("1.3.0");
    expect(item.category).toBe("productivity");
    expect(item.author).toBe("Anton Abyzov");
    expect(item.license).toBe("MIT");
    expect(item.homepage).toBe("https://verified-skill.com/obsidian-brain");
    expect(item.tags).toEqual(["obsidian", "knowledge-base"]);
    expect(item.deps).toEqual(["another-skill"]);
    expect(item.mcpDeps).toEqual(["obsidian-mcp", "filesystem"]);
    expect(item.entryPoint).toBe("SKILL.md");
    expect(item.lastModified).toBe("2026-03-15T10:20:30.000Z");
    expect(item.sizeBytes).toBe(4096);
    expect(item.sourceAgent).toBeNull();
  });

  it("surfaces sourceAgent for installed skills", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseRaw,
          dir: "/home/u/.claude/skills/graph-scan",
          origin: "installed",
          sourceAgent: "claude-code",
        },
      ]),
    );
    const [item] = await api.getSkills();
    expect(item.origin).toBe("installed");
    expect(item.sourceAgent).toBe("claude-code");
  });

  it("defaults missing frontmatter scalars to null (not undefined)", async () => {
    mockFetch.mockResolvedValue(okJson([{ ...baseRaw }])); // no frontmatter
    const [item] = await api.getSkills();
    // JSON-serializable: null (not undefined) per contract
    expect(item.description).toBeNull();
    expect(item.version).toBeNull();
    expect(item.category).toBeNull();
    expect(item.author).toBeNull();
    expect(item.license).toBeNull();
    expect(item.homepage).toBeNull();
    expect(item.entryPoint).toBeNull();
    expect(item.lastModified).toBeNull();
    expect(item.sizeBytes).toBeNull();
    expect(item.sourceAgent).toBeNull();
  });

  it("defaults missing frontmatter arrays to null (not [] and not undefined)", async () => {
    mockFetch.mockResolvedValue(okJson([{ ...baseRaw }]));
    const [item] = await api.getSkills();
    expect(item.tags).toBeNull();
    expect(item.deps).toBeNull();
    expect(item.mcpDeps).toBeNull();
  });

  it("coerces server-sent `undefined` scalars to null at the boundary", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseRaw,
          // Explicit undefined (rare, but some proxies may do this)
          description: undefined,
          version: undefined,
          tags: undefined,
          mcpDeps: undefined,
        },
      ]),
    );
    const [item] = await api.getSkills();
    expect(item.description).toBeNull();
    expect(item.version).toBeNull();
    expect(item.tags).toBeNull();
    expect(item.mcpDeps).toBeNull();
  });

  it("drops non-string array entries and coerces empty arrays to null", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseRaw,
          tags: ["valid", 42, null, "also-valid"],
          deps: [],
          mcpDeps: [""],
        },
      ]),
    );
    const [item] = await api.getSkills();
    expect(item.tags).toEqual(["valid", "also-valid"]);
    expect(item.deps).toBeNull(); // empty → null
    expect(item.mcpDeps).toBeNull(); // all empty strings → null
  });

  it("coerces invalid sizeBytes (non-number) to null", async () => {
    mockFetch.mockResolvedValue(
      okJson([{ ...baseRaw, sizeBytes: "4096" }]), // string, not number
    );
    const [item] = await api.getSkills();
    expect(item.sizeBytes).toBeNull();
  });

  it("preserves existing non-frontmatter fields across enrichment", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseRaw,
          evalCount: 5,
          assertionCount: 12,
          benchmarkStatus: "pass",
          lastBenchmark: "2026-04-01T12:00:00.000Z",
          description: "Short description",
          version: "2.0.0",
        },
      ]),
    );
    const [item] = await api.getSkills();
    expect(item.evalCount).toBe(5);
    expect(item.assertionCount).toBe(12);
    expect(item.benchmarkStatus).toBe("pass");
    expect(item.lastBenchmark).toBe("2026-04-01T12:00:00.000Z");
    expect(item.description).toBe("Short description");
    expect(item.version).toBe("2.0.0");
  });
});

describe("T-025: SkillInfo type includes nullable frontmatter fields", () => {
  it("accepts a SkillInfo with all new fields populated", () => {
    const s: SkillInfo = {
      plugin: "p",
      skill: "s",
      dir: "/tmp",
      hasEvals: true,
      hasBenchmark: false,
      evalCount: 1,
      assertionCount: 2,
      benchmarkStatus: "pass",
      lastBenchmark: "2026-01-01T00:00:00Z",
      origin: "installed",
      description: "desc",
      version: "1.0.0",
      category: "cat",
      author: "me",
      license: "MIT",
      homepage: "https://x",
      tags: ["a"],
      deps: ["b"],
      mcpDeps: ["c"],
      entryPoint: "SKILL.md",
      lastModified: "2026-01-01T00:00:00Z",
      sizeBytes: 123,
      sourceAgent: "claude-code",
    };
    expect(s.description).toBe("desc");
    expect(s.sourceAgent).toBe("claude-code");
  });

  it("accepts null for every frontmatter field (backward-compat: missing → null)", () => {
    const s: SkillInfo = {
      plugin: "p",
      skill: "s",
      dir: "/tmp",
      hasEvals: false,
      hasBenchmark: false,
      evalCount: 0,
      assertionCount: 0,
      benchmarkStatus: "missing",
      lastBenchmark: null,
      origin: "source",
      description: null,
      version: null,
      category: null,
      author: null,
      license: null,
      homepage: null,
      tags: null,
      deps: null,
      mcpDeps: null,
      entryPoint: null,
      lastModified: null,
      sizeBytes: null,
      sourceAgent: null,
    };
    expect(s.description).toBeNull();
    expect(s.tags).toBeNull();
    expect(s.sizeBytes).toBeNull();
  });

  it("still compiles when frontmatter fields are omitted entirely (existing consumers)", () => {
    // This is the backward-compat guarantee — old code that only sets the
    // original SkillInfo fields must continue to compile.
    const s: SkillInfo = {
      plugin: "p",
      skill: "s",
      dir: "/tmp",
      hasEvals: true,
      hasBenchmark: false,
      evalCount: 3,
      assertionCount: 7,
      benchmarkStatus: "pass",
      lastBenchmark: null,
      origin: "source",
    };
    expect(s.description).toBeUndefined();
  });
});
