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
