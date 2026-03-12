// ---------------------------------------------------------------------------
// Tests: MiniTrend dual-line sparkline
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { MiniTrend } from "../historyUtils.js";
import type { CaseHistoryEntry } from "../../types.js";

function makeEntry(
  type: CaseHistoryEntry["type"],
  pass_rate: number,
  baselinePassRate?: number,
  timestamp = "2026-03-09T12:00:00Z",
): CaseHistoryEntry {
  return { timestamp, model: "sonnet", type, pass_rate, assertions: [], baselinePassRate };
}

describe("MiniTrend dual-line — basic guards", () => {
  it("returns null for zero entries", () => {
    expect(MiniTrend({ entries: [] })).toBeNull();
  });

  it("returns null for a single benchmark entry", () => {
    expect(MiniTrend({ entries: [makeEntry("benchmark", 0.8)] })).toBeNull();
  });

  it("returns null when both lines have < 2 points (e.g. two improve entries)", () => {
    const entries = [makeEntry("improve", 0.8), makeEntry("improve", 0.6)];
    expect(MiniTrend({ entries })).toBeNull();
  });
});

describe("MiniTrend dual-line — skill line (blue)", () => {
  it("renders SVG with 2 benchmark entries", () => {
    const entries = [makeEntry("benchmark", 0.8), makeEntry("benchmark", 0.6)];
    const result = MiniTrend({ entries });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("svg");
  });

  it("skill polyline uses var(--accent) stroke color", () => {
    const entries = [makeEntry("benchmark", 0.8), makeEntry("benchmark", 0.6)];
    const svg = MiniTrend({ entries });
    // SVG children include a blue polyline
    const children = (svg?.props?.children as React.ReactNode[]).flat(2);
    const polylines = children.filter(
      (c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "polyline",
    );
    const bluePolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--accent)",
    );
    expect(bluePolyline).toBeDefined();
  });

  it("benchmark entries contribute to skill line only (no baseline polyline)", () => {
    const entries = [makeEntry("benchmark", 0.8), makeEntry("benchmark", 0.6)];
    const svg = MiniTrend({ entries });
    const children = (svg?.props?.children as React.ReactNode[]).flat(2);
    const polylines = children.filter(
      (c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "polyline",
    );
    const grayPolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--text-tertiary)",
    );
    expect(grayPolyline).toBeUndefined();
  });
});

describe("MiniTrend dual-line — baseline line (gray)", () => {
  it("baseline entries contribute to baseline line only (no blue polyline)", () => {
    const entries = [makeEntry("baseline", 0.7), makeEntry("baseline", 0.5)];
    const svg = MiniTrend({ entries });
    expect(svg).not.toBeNull();
    const children = (svg?.props?.children as React.ReactNode[]).flat(2);
    const polylines = children.filter(
      (c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "polyline",
    );
    const bluePolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--accent)",
    );
    expect(bluePolyline).toBeUndefined();
    const grayPolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--text-tertiary)",
    );
    expect(grayPolyline).toBeDefined();
  });
});

describe("MiniTrend dual-line — comparison entries", () => {
  it("comparison entries contribute to both lines", () => {
    const entries = [
      makeEntry("comparison", 0.9, 0.5),
      makeEntry("comparison", 0.7, 0.4),
    ];
    const svg = MiniTrend({ entries });
    expect(svg).not.toBeNull();
    const children = (svg?.props?.children as React.ReactNode[]).flat(2);
    const polylines = children.filter(
      (c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "polyline",
    );
    const bluePolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--accent)",
    );
    const grayPolyline = polylines.find(
      (p: unknown) => (p as { props?: { stroke?: string } })?.props?.stroke === "var(--text-tertiary)",
    );
    expect(bluePolyline).toBeDefined();
    expect(grayPolyline).toBeDefined();
  });

  it("comparison entry with undefined baselinePassRate does not crash", () => {
    const entries = [
      makeEntry("comparison", 0.9, undefined),
      makeEntry("comparison", 0.7, undefined),
    ];
    // Only skill line has 2 points; baseline has 0 → no gray line, no crash
    const svg = MiniTrend({ entries });
    expect(svg).not.toBeNull(); // skill line still renders
  });
});

describe("MiniTrend dual-line — excluded types", () => {
  it("improve entries are excluded from both lines", () => {
    const entries = [makeEntry("improve", 0.8), makeEntry("improve", 0.6)];
    expect(MiniTrend({ entries })).toBeNull();
  });

  it("instruct entries are excluded from both lines", () => {
    const entries = [makeEntry("instruct", 0.8), makeEntry("instruct", 0.6)];
    expect(MiniTrend({ entries })).toBeNull();
  });

  it("model-compare entries are excluded from both lines", () => {
    const entries = [makeEntry("model-compare", 0.8), makeEntry("model-compare", 0.6)];
    expect(MiniTrend({ entries })).toBeNull();
  });
});

describe("MiniTrend dual-line — SVG dimensions", () => {
  it("SVG dimensions remain 80x24", () => {
    const entries = [makeEntry("benchmark", 0.8), makeEntry("benchmark", 0.6)];
    const svg = MiniTrend({ entries });
    expect(svg?.props?.width).toBe(80);
    expect(svg?.props?.height).toBe(24);
  });
});

// Import React for JSX type
import type React from "react";
