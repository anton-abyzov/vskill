// ---------------------------------------------------------------------------
// 0740 T-008 — dedupeByDir helper unit tests
// ---------------------------------------------------------------------------
// Defensive dedupe at the api-routes concat step. The Layout 2 fix in
// skill-scanner.ts is the primary defense; this is the safety net for when a
// future scanner pass introduces overlap. Precedence: `authoring-plugin`
// (manifest-backed) wins.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dedupeByDir } from "../skill-scanner.js";
import type { SkillInfo } from "../skill-scanner.js";

function row(over: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: "personal",
    skill: "obsidian-brain",
    dir: "/tmp/plugins/personal/skills/obsidian-brain",
    hasEvals: false,
    hasBenchmark: false,
    origin: "source",
    ...over,
  } as SkillInfo;
}

describe("0740 dedupeByDir", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns identity when no duplicates", () => {
    const input: SkillInfo[] = [
      row({ dir: "/a", scopeV2: "available-project" }),
      row({ dir: "/b", scopeV2: "authoring-plugin" }),
    ];
    const out = dedupeByDir(input);
    expect(out.length).toBe(2);
    expect(out.map((s) => s.dir).sort()).toEqual(["/a", "/b"]);
  });

  it("collapses two entries with same `dir`, prefers authoring-plugin", () => {
    const ap = row({ scopeV2: "authoring-plugin" });
    const apr = row({ scopeV2: "authoring-project" });
    // input order: authoring-project FIRST (the order today's bug produces)
    const out = dedupeByDir([apr, ap]);
    expect(out.length).toBe(1);
    expect(out[0].scopeV2).toBe("authoring-plugin");
  });

  it("collapses two entries with same `dir`, prefers authoring-plugin (reversed input)", () => {
    const ap = row({ scopeV2: "authoring-plugin" });
    const apr = row({ scopeV2: "authoring-project" });
    const out = dedupeByDir([ap, apr]);
    expect(out.length).toBe(1);
    expect(out[0].scopeV2).toBe("authoring-plugin");
  });

  it("keeps first-seen when neither entry is authoring-plugin", () => {
    const a = row({ scopeV2: "authoring-project" });
    const b = row({ scopeV2: "available-project" });
    const out = dedupeByDir([a, b]);
    expect(out.length).toBe(1);
    expect(out[0].scopeV2).toBe("authoring-project");
  });

  it("warns when collapsing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ap = row({ scopeV2: "authoring-plugin" });
    const apr = row({ scopeV2: "authoring-project" });
    dedupeByDir([apr, ap]);
    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0]?.[0] ?? "");
    expect(message).toContain("dedupeByDir");
    expect(message).toContain("authoring-plugin");
  });

  it("does NOT warn when no duplicates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dedupeByDir([row({ dir: "/a" }), row({ dir: "/b" })]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("handles empty input", () => {
    expect(dedupeByDir([])).toEqual([]);
  });
});
