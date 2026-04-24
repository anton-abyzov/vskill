// ---------------------------------------------------------------------------
// 0688 T-018: provenance sidecar normalization on /api/skills response.
//
// Server may attach a `provenance` field to OWN-scope skills when a
// `.vskill-meta.json` sidecar is present. The client normalizer MUST:
//   - pass through a well-formed Provenance object
//   - coerce malformed shapes to null (defensive)
//   - leave the field undefined when the server omits it
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { api } from "../api";

const mockFetch = vi.fn();
global.fetch = mockFetch as typeof fetch;

function okJson(data: unknown) {
  return { ok: true, json: async () => data } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

const base = {
  plugin: "obsidian-brain",
  skill: "graph-scan",
  dir: "/tmp/x",
  hasEvals: false,
  hasBenchmark: false,
  evalCount: 0,
  assertionCount: 0,
  benchmarkStatus: "missing" as const,
  lastBenchmark: null,
  origin: "source" as const,
  scope: "own" as const,
};

describe("api.getSkills — provenance normalization (T-018)", () => {
  it("passes through a well-formed Provenance object", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        {
          ...base,
          provenance: {
            promotedFrom: "installed",
            sourcePath: "/abs/path/to/source",
            promotedAt: 1700000000000,
            sourceSkillVersion: "1.2.3",
          },
        },
      ]),
    );
    const skills = await api.getSkills();
    expect(skills[0].provenance).toEqual({
      promotedFrom: "installed",
      sourcePath: "/abs/path/to/source",
      promotedAt: 1700000000000,
      sourceSkillVersion: "1.2.3",
    });
  });

  it("accepts provenance without optional sourceSkillVersion", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        {
          ...base,
          provenance: {
            promotedFrom: "global",
            sourcePath: "/abs/path",
            promotedAt: 1700000000000,
          },
        },
      ]),
    );
    const skills = await api.getSkills();
    expect(skills[0].provenance?.promotedFrom).toBe("global");
    expect(skills[0].provenance?.sourceSkillVersion).toBeUndefined();
  });

  it("coerces malformed provenance to null", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        // Missing required sourcePath
        { ...base, provenance: { promotedFrom: "installed", promotedAt: 1 } },
      ]),
    );
    const skills = await api.getSkills();
    expect(skills[0].provenance).toBeNull();
  });

  it("rejects invalid promotedFrom value as null", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        {
          ...base,
          provenance: {
            promotedFrom: "bogus",
            sourcePath: "/x",
            promotedAt: 1,
          },
        },
      ]),
    );
    const skills = await api.getSkills();
    expect(skills[0].provenance).toBeNull();
  });

  it("preserves explicit null", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, provenance: null }]));
    const skills = await api.getSkills();
    expect(skills[0].provenance).toBeNull();
  });

  it("leaves provenance undefined when server omits the field", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base }]));
    const skills = await api.getSkills();
    expect(skills[0].provenance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 0698 T-001: scope union + group/source derivation + wire normalizer.
//
// New scope vocabulary aligned with Anthropic docs:
//   "available-project"  (was "installed")
//   "available-personal" (was "global")
//   "available-plugin"   (NEW — CC only)
//   "authoring-project"  (was "own")
//   "authoring-plugin"   (NEW — CC only)
//
// Legacy strings from server/0688 are translated at the normalizer boundary.
// ---------------------------------------------------------------------------

import { normalizeSkillScope, deriveScopeGroup, deriveScopeSource } from "../api";
import type { SkillScope, SkillGroup, SkillSource } from "../types";

describe("normalizeSkillScope (0698 T-001)", () => {
  it("translates legacy 'own' → 'authoring-project'", () => {
    expect(normalizeSkillScope("own")).toBe("authoring-project");
  });

  it("translates legacy 'installed' → 'available-project'", () => {
    expect(normalizeSkillScope("installed")).toBe("available-project");
  });

  it("translates legacy 'global' → 'available-personal'", () => {
    expect(normalizeSkillScope("global")).toBe("available-personal");
  });

  it("passes through new 'available-project' unchanged", () => {
    expect(normalizeSkillScope("available-project")).toBe("available-project");
  });

  it("passes through new 'available-personal' unchanged", () => {
    expect(normalizeSkillScope("available-personal")).toBe("available-personal");
  });

  it("passes through new 'available-plugin' unchanged", () => {
    expect(normalizeSkillScope("available-plugin")).toBe("available-plugin");
  });

  it("passes through new 'authoring-project' unchanged", () => {
    expect(normalizeSkillScope("authoring-project")).toBe("authoring-project");
  });

  it("passes through new 'authoring-plugin' unchanged", () => {
    expect(normalizeSkillScope("authoring-plugin")).toBe("authoring-plugin");
  });

  it("defaults unknown/missing input to 'authoring-project' (safe default)", () => {
    expect(normalizeSkillScope(undefined)).toBe("authoring-project");
    expect(normalizeSkillScope(null)).toBe("authoring-project");
    expect(normalizeSkillScope("bogus")).toBe("authoring-project");
    expect(normalizeSkillScope(42 as unknown as string)).toBe("authoring-project");
  });

  it("rejects dropped 'enterprise' scope at compile time", () => {
    // @ts-expect-error — 'enterprise' is NOT in the SkillScope union
    const _invalid: SkillScope = "enterprise";
    expect(_invalid).toBe("enterprise"); // runtime value exists; TS compile error is the real assertion
  });
});

describe("deriveScopeGroup (0698 T-001)", () => {
  const cases: Array<[SkillScope, SkillGroup]> = [
    ["available-project", "available"],
    ["available-personal", "available"],
    ["available-plugin", "available"],
    ["authoring-project", "authoring"],
    ["authoring-plugin", "authoring"],
  ];
  it.each(cases)("scope %s → group %s", (scope, expected) => {
    expect(deriveScopeGroup(scope)).toBe(expected);
  });
});

describe("deriveScopeSource (0698 T-001)", () => {
  const cases: Array<[SkillScope, SkillSource]> = [
    ["available-project", "project"],
    ["available-personal", "personal"],
    ["available-plugin", "plugin"],
    ["authoring-project", "project"],
    ["authoring-plugin", "plugin"],
  ];
  it.each(cases)("scope %s → source %s", (scope, expected) => {
    expect(deriveScopeSource(scope)).toBe(expected);
  });
});

describe("api.getSkills — scope normalization + group/source derivation (0698 T-001)", () => {
  it("translates legacy 'installed' server scope → 'available-project' with group/source derived", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, scope: "installed" }]));
    const [s] = await api.getSkills();
    expect(s.scopeV2).toBe("available-project");
    expect(s.group).toBe("available");
    expect(s.source).toBe("project");
  });

  it("translates legacy 'global' server scope → 'available-personal'", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, scope: "global" }]));
    const [s] = await api.getSkills();
    expect(s.scopeV2).toBe("available-personal");
    expect(s.group).toBe("available");
    expect(s.source).toBe("personal");
  });

  it("translates legacy 'own' server scope → 'authoring-project'", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, scope: "own" }]));
    const [s] = await api.getSkills();
    expect(s.scopeV2).toBe("authoring-project");
    expect(s.group).toBe("authoring");
    expect(s.source).toBe("project");
  });

  it("passes through new 'available-plugin' scope from server", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, scope: "available-plugin", pluginName: "sw", pluginNamespace: "sw:increment" }]));
    const [s] = await api.getSkills();
    expect(s.scopeV2).toBe("available-plugin");
    expect(s.group).toBe("available");
    expect(s.source).toBe("plugin");
    expect(s.pluginName).toBe("sw");
    expect(s.pluginNamespace).toBe("sw:increment");
  });

  it("passes through new 'authoring-plugin' with manifest path", async () => {
    mockFetch.mockResolvedValueOnce(okJson([{ ...base, scope: "authoring-plugin", pluginName: "my-plugin", pluginManifestPath: "/abs/path/.claude-plugin/plugin.json" }]));
    const [s] = await api.getSkills();
    expect(s.scopeV2).toBe("authoring-plugin");
    expect(s.source).toBe("plugin");
    expect(s.pluginName).toBe("my-plugin");
    expect(s.pluginManifestPath).toBe("/abs/path/.claude-plugin/plugin.json");
  });

  it("populates precedenceRank and shadowedBy when server provides them", async () => {
    mockFetch.mockResolvedValueOnce(
      okJson([
        { ...base, scope: "available-project", precedenceRank: 2, shadowedBy: "available-personal" },
        { ...base, skill: "pdf-winner", scope: "available-personal", precedenceRank: 1, shadowedBy: null },
      ]),
    );
    const skills = await api.getSkills();
    expect(skills[0].precedenceRank).toBe(2);
    expect(skills[0].shadowedBy).toBe("available-personal");
    expect(skills[1].precedenceRank).toBe(1);
    expect(skills[1].shadowedBy).toBeNull();
  });
});
