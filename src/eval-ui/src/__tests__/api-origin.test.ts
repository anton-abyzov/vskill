// ---------------------------------------------------------------------------
// T-021 (AC-US1-03): /api/skills response must always carry a non-null origin.
//
// The origin field is the SSoT for the OWN/INSTALLED sidebar split. The field
// is produced by classifyOrigin() in src/eval/skill-scanner.ts and surfaced
// through the /api/skills endpoint. This test locks the contract at the API
// client boundary so downstream UI code (sidebar, detail panel) can treat
// SkillInfo.origin as a guaranteed, non-null "source" | "installed" literal.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("T-021: api.getSkills() origin contract", () => {
  const baseSkill = {
    plugin: "obsidian-brain",
    skill: "graph-scan",
    dir: "/home/u/project/plugins/obsidian-brain/skills/graph-scan",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 3,
    assertionCount: 7,
    benchmarkStatus: "pending" as const,
    lastBenchmark: null,
  };

  it("passes through origin='source' from the server unchanged", async () => {
    mockFetch.mockResolvedValue(okJson([{ ...baseSkill, origin: "source" }]));
    const result = await api.getSkills();
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe("source");
  });

  it("passes through origin='installed' from the server unchanged", async () => {
    mockFetch.mockResolvedValue(
      okJson([
        {
          ...baseSkill,
          dir: "/home/u/.claude/skills/graph-scan",
          origin: "installed",
        },
      ]),
    );
    const result = await api.getSkills();
    expect(result[0].origin).toBe("installed");
  });

  it("defaults to 'source' with a console.warn when origin is missing (graceful degradation)", async () => {
    // Older server/proxies may drop the field. The client MUST backfill it so
    // downstream consumers never see undefined.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(okJson([{ ...baseSkill }])); // no origin
    const result = await api.getSkills();
    expect(result[0].origin).toBe("source");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/origin/i);
  });

  it("defaults to 'source' with a warn when origin is explicitly null", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(
      okJson([{ ...baseSkill, origin: null }]),
    );
    const result = await api.getSkills();
    expect(result[0].origin).toBe("source");
    expect(warn).toHaveBeenCalled();
  });

  it("rejects unknown origin values by defaulting to 'source' and warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(
      okJson([{ ...baseSkill, origin: "other" }]),
    );
    const result = await api.getSkills();
    expect(result[0].origin).toBe("source");
    expect(warn).toHaveBeenCalled();
  });

  it("preserves all other fields while normalizing origin", async () => {
    mockFetch.mockResolvedValue(
      okJson([{ ...baseSkill, origin: "installed" }]),
    );
    const [item] = await api.getSkills();
    expect(item.plugin).toBe("obsidian-brain");
    expect(item.skill).toBe("graph-scan");
    expect(item.evalCount).toBe(3);
    expect(item.assertionCount).toBe(7);
    expect(item.benchmarkStatus).toBe("pending");
    expect(item.lastBenchmark).toBeNull();
  });
});

describe("T-021: SkillInfo.origin type contract", () => {
  it("requires a non-null, non-optional origin literal on SkillInfo", () => {
    // Compile-time test: omitting origin must be a TS error. The assignment
    // below is the positive case — if the SkillInfo type ever loosens origin
    // to `| null | undefined`, the assertions in this suite still pass at
    // runtime but the intent is documented for future maintainers.
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
    };
    // Runtime sanity
    expect(s.origin === "source" || s.origin === "installed").toBe(true);
    // Negative test: origin must NOT be widened to include null
    // @ts-expect-error origin cannot be null
    const withNull: SkillInfo = { ...s, origin: null };
    expect(withNull).toBeDefined();
  });
});
