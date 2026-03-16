import { describe, it, expect, vi } from "vitest";

// Mock React hooks before importing TrendChart
vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useMemo: (fn: () => unknown) => fn(),
}));

import { TrendChart } from "../../components/TrendChart";
import type { HistorySummary } from "../../types";

function makeEntry(
  type: string,
  passRate: number,
  ts = "2026-03-09T12:00:00Z",
): HistorySummary {
  return {
    timestamp: ts,
    filename: "f.json",
    model: "sonnet",
    skillName: "test",
    passRate,
    type: type as HistorySummary["type"],
    caseCount: 1,
    totalDurationMs: 1000,
    totalTokens: 100,
  };
}

type ReactEl = { type: string; props: Record<string, unknown> };

/** Recursively collect all elements of a given type from a React element tree. */
function collectElements(node: unknown, tagName: string): ReactEl[] {
  if (!node || typeof node !== "object") return [];

  // Handle arrays (from .map() calls in JSX)
  if (Array.isArray(node)) {
    const results: ReactEl[] = [];
    for (const child of node) {
      results.push(...collectElements(child, tagName));
    }
    return results;
  }

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  const results: ReactEl[] = [];
  if (el.type === tagName) {
    results.push(el as ReactEl);
  }
  if (el.props) {
    const children = el.props.children;
    if (children != null && typeof children === "object") {
      results.push(...collectElements(children, tagName));
    }
  }
  return results;
}

/** Find first element of given type in tree. */
function findElement(
  node: unknown,
  tagName: string,
): { type: string; props: Record<string, unknown> } | null {
  const found = collectElements(node, tagName);
  return found.length > 0 ? found[0] : null;
}

describe("TrendChart", () => {
  it("renders SVG with circles for 3 entries", () => {
    const entries = [
      makeEntry("benchmark", 0.8, "2026-03-07T12:00:00Z"),
      makeEntry("benchmark", 0.9, "2026-03-08T12:00:00Z"),
      makeEntry("benchmark", 1.0, "2026-03-09T12:00:00Z"),
    ];
    const result = TrendChart({ entries });
    expect(result).not.toBeNull();

    // Root is a div wrapper; find the SVG inside
    const svg = findElement(result, "svg");
    expect(svg).not.toBeNull();

    // Should have 3 circle elements (one per data point)
    const circles = collectElements(result, "circle");
    expect(circles).toHaveLength(3);
  });

  it("does not render with 1 entry", () => {
    const result = TrendChart({ entries: [makeEntry("benchmark", 0.5)] });
    expect(result).toBeNull();
  });

  it("does not render with 0 entries", () => {
    const result = TrendChart({ entries: [] });
    expect(result).toBeNull();
  });

  it("colors circles by type", () => {
    const entries = [
      makeEntry("benchmark", 0.8, "2026-03-07T12:00:00Z"),
      makeEntry("baseline", 0.6, "2026-03-08T12:00:00Z"),
      makeEntry("benchmark", 0.9, "2026-03-09T12:00:00Z"),
    ];
    const result = TrendChart({ entries });
    const circles = collectElements(result, "circle");
    expect(circles).toHaveLength(3);

    // benchmark circles should use #6383ff
    expect(circles[0].props.fill).toBe("#6383ff");
    expect(circles[2].props.fill).toBe("#6383ff");

    // baseline circle should use #fb923c
    expect(circles[1].props.fill).toBe("#fb923c");
  });
});
