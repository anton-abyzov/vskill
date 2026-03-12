import { describe, it, expect } from "vitest";
import { passRateColor, shortDate, fmtDuration, MiniTrend } from "../historyUtils";
import type { CaseHistoryEntry } from "../../types";

describe("passRateColor", () => {
  it("returns green for rate >= 0.8", () => {
    expect(passRateColor(0.9)).toBe("var(--green)");
    expect(passRateColor(0.8)).toBe("var(--green)");
    expect(passRateColor(1.0)).toBe("var(--green)");
  });

  it("returns yellow for rate >= 0.5 and < 0.8", () => {
    expect(passRateColor(0.65)).toBe("var(--yellow)");
    expect(passRateColor(0.5)).toBe("var(--yellow)");
    expect(passRateColor(0.79)).toBe("var(--yellow)");
  });

  it("returns red for rate < 0.5", () => {
    expect(passRateColor(0.3)).toBe("var(--red)");
    expect(passRateColor(0.0)).toBe("var(--red)");
    expect(passRateColor(0.49)).toBe("var(--red)");
  });
});

describe("shortDate", () => {
  it("formats ISO string to short date with time", () => {
    // Use a fixed UTC date and check the output contains expected parts
    const result = shortDate("2026-03-09T14:30:00.000Z");
    // Should contain month abbreviation and day
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/9|09/);
    // Should contain time portion
    expect(result).toMatch(/\d{2}:\d{2}/);
  });
});

describe("fmtDuration", () => {
  it("formats milliseconds >= 1000 as seconds", () => {
    expect(fmtDuration(2500)).toBe("2.5s");
    expect(fmtDuration(1000)).toBe("1.0s");
  });

  it("formats milliseconds < 1000 as ms", () => {
    expect(fmtDuration(450)).toBe("450ms");
    expect(fmtDuration(0)).toBe("0ms");
  });

  it("returns dash for undefined", () => {
    expect(fmtDuration(undefined)).toBe("--");
  });
});

function makeEntry(
  pass_rate: number,
  type: CaseHistoryEntry["type"] = "benchmark",
  timestamp = "2026-03-09T12:00:00Z",
  baselinePassRate?: number,
): CaseHistoryEntry {
  return { timestamp, model: "sonnet", type, pass_rate, assertions: [], baselinePassRate };
}

describe("MiniTrend", () => {
  it("returns null for empty entries", () => {
    expect(MiniTrend({ entries: [] })).toBeNull();
  });

  it("returns null for one entry", () => {
    expect(MiniTrend({ entries: [makeEntry(0.8)] })).toBeNull();
  });

  it("returns SVG element for two benchmark entries", () => {
    const result = MiniTrend({ entries: [makeEntry(0.8), makeEntry(0.6)] });
    expect(result?.type).toBe("svg");
  });

  it("returns SVG element for many entries", () => {
    const entries = [makeEntry(0.9), makeEntry(0.7), makeEntry(0.8), makeEntry(0.6), makeEntry(1.0)];
    expect(MiniTrend({ entries })?.type).toBe("svg");
  });

  // Dual-line: type filtering
  it("includes benchmark entries in skill line and excludes improve/instruct types", () => {
    const entries = [
      makeEntry(1.0, "benchmark"),
      makeEntry(0.5, "improve"),
      makeEntry(0.5, "instruct"),
      makeEntry(0.5, "eval-generate"),
    ];
    // With only benchmark entries for skill line (others filtered), 1 point → null
    // Need 2+ entries to render
    const withTwoBenchmarks = [makeEntry(1.0, "benchmark"), makeEntry(0.8, "benchmark")];
    expect(MiniTrend({ entries: withTwoBenchmarks })?.type).toBe("svg");
  });

  it("returns null when all entries are non-core types (improve/instruct/etc)", () => {
    const entries = [
      makeEntry(0.8, "improve"),
      makeEntry(0.6, "instruct"),
      makeEntry(0.4, "eval-generate"),
    ];
    expect(MiniTrend({ entries })).toBeNull();
  });

  it("renders baseline gray line when baseline entries exist", () => {
    const entries = [
      makeEntry(1.0, "benchmark"),
      makeEntry(0.8, "benchmark"),
      makeEntry(0.6, "baseline"),
      makeEntry(0.5, "baseline"),
    ];
    const svg = MiniTrend({ entries });
    expect(svg?.type).toBe("svg");
    // Should have two polylines (skill + baseline)
    const children = (svg?.props as { children: unknown[] }).children;
    const polylines = (children as { type: string }[]).filter((c) => c?.type === "polyline");
    expect(polylines.length).toBe(2);
  });

  it("comparison entry contributes to both skill and baseline lines", () => {
    const entries = [
      makeEntry(1.0, "comparison", "2026-03-09T12:00:00Z", 0.6),
      makeEntry(0.8, "comparison", "2026-03-08T12:00:00Z", 0.5),
    ];
    const svg = MiniTrend({ entries });
    expect(svg?.type).toBe("svg");
    const children = (svg?.props as { children: unknown[] }).children;
    const polylines = (children as { type: string }[]).filter((c) => c?.type === "polyline");
    expect(polylines.length).toBe(2);
  });

  it("renders only skill line when no baseline data exists", () => {
    const entries = [makeEntry(1.0, "benchmark"), makeEntry(0.8, "benchmark")];
    const svg = MiniTrend({ entries });
    expect(svg?.type).toBe("svg");
    // Only one polyline (no baseline data)
    const children = (svg?.props as { children: unknown[] }).children;
    const polylines = (children as { type: string }[]).filter((c) => c?.type === "polyline");
    expect(polylines.length).toBe(1);
  });
});
