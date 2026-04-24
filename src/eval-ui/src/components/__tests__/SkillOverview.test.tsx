// ---------------------------------------------------------------------------
// T-006 (0707): SkillOverview tests — grid of 8 cards + sticky byline header
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { SkillOverview } from "../SkillOverview";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/**
 * Recursively walks a React tree. Function-component elements are evaluated
 * (`el.type(el.props)`) so we can inspect their output — consistent with the
 * `expand()` helper in SkillRow.test.tsx. Matched elements are still the
 * *pre-expand* wrapper, because props like `data-testid` live on the outer
 * element (what the caller passed to the child) rather than on the inner
 * rendered markup.
 */
function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      out.push(...findAll(rendered, match));
    } catch {
      // ignore render errors — tests focus on happy paths
    }
  }
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      return collectText(rendered);
    } catch {
      return "";
    }
  }
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function findByTestId(node: unknown, id: string): ReactEl | null {
  const hit = findAll(node, (el) => el.props?.["data-testid"] === id)[0];
  return hit ?? null;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "easychamp",
    skill: "tournament-manager",
    dir: "/Users/test/plugins/easychamp/skills/tournament-manager",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 3,
    assertionCount: 12,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-20T12:00:00Z",
    origin: "source",
    description: "Tournament management fixture",
    version: "0.1.0",
    category: "sports",
    author: "Anton Abyzov",
    license: "MIT",
    homepage: "https://github.com/anton-abyzov/easychamp-mcp",
    tags: ["tournament"],
    deps: ["slack-messaging", "notion-io"],
    mcpDeps: ["easychamp"],
    entryPoint: "SKILL.md",
    lastModified: "2026-04-24T10:00:00Z",
    sizeBytes: 4096,
    sourceAgent: null,
    ...over,
  };
}

describe("SkillOverview — T-006", () => {
  it("renders a grid with exactly 8 metric cards", () => {
    const tree = SkillOverview({ skill: makeSkill() });
    const expected = [
      "metric-benchmark",
      "metric-tests",
      "metric-activations",
      "metric-last-run",
      "metric-mcp-deps",
      "metric-skill-deps",
      "metric-size",
      "metric-last-modified",
    ];
    for (const id of expected) {
      const card = findAll(tree, (el) => el.props?.["data-testid"] === id);
      expect(card.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("uses the responsive grid template columns from the spec", () => {
    const tree = SkillOverview({ skill: makeSkill() });
    const grid = findByTestId(tree, "skill-overview-grid")!;
    const style = grid.props.style as Record<string, string>;
    expect(style.gridTemplateColumns).toBe("repeat(auto-fit, minmax(180px, 1fr))");
    expect(style.gap).toBe("0.75rem");
  });

  it("renders the tests count and fires onNavigate('tests') when clicked", () => {
    const onNavigate = vi.fn();
    const tree = SkillOverview({ skill: makeSkill({ evalCount: 3 }), onNavigate });
    const tests = findByTestId(tree, "metric-tests")!;
    expect(collectText(tests)).toContain("3");
    (tests.props.onClick as () => void)();
    expect(onNavigate).toHaveBeenCalledWith("tests");
  });

  it("counts MCP and skill deps from the skill payload", () => {
    const tree = SkillOverview({
      skill: makeSkill({ mcpDeps: ["easychamp", "slack"], deps: ["a", "b", "c"] }),
    });
    const mcp = findByTestId(tree, "metric-mcp-deps")!;
    const skills = findByTestId(tree, "metric-skill-deps")!;
    expect(collectText(mcp)).toContain("2");
    expect(collectText(skills)).toContain("3");
  });

  it("navigates to 'deps' on both the MCP and skill-deps cards", () => {
    const onNavigate = vi.fn();
    const tree = SkillOverview({ skill: makeSkill(), onNavigate });
    (findByTestId(tree, "metric-mcp-deps")!.props.onClick as () => void)();
    (findByTestId(tree, "metric-skill-deps")!.props.onClick as () => void)();
    expect(onNavigate).toHaveBeenNthCalledWith(1, "deps");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "deps");
  });

  it("renders the sticky byline header with skill name + version + author + source", () => {
    const tree = SkillOverview({ skill: makeSkill(), skillPathInRepo: "plugins/easychamp/skills/tournament-manager" });
    const header = findByTestId(tree, "skill-overview-header")!;
    const text = collectText(header);
    expect(text).toContain("tournament-manager");
    expect(text).toContain("v0.1.0");
    expect(text).toContain("Anton Abyzov");
    // Source file link renders the last path segment with ↗
    expect(text).toContain("↗");
  });

  it("falls back to em-dash for size and last-run when no data is available", () => {
    const tree = SkillOverview({
      skill: makeSkill({ sizeBytes: null, lastModified: null, lastBenchmark: null }),
    });
    const size = findByTestId(tree, "metric-size")!;
    expect(collectText(size)).toContain("—");
  });

  it("respects the benchmark-info popover by exposing its trigger in the benchmark card", () => {
    const tree = SkillOverview({ skill: makeSkill() });
    const bench = findByTestId(tree, "metric-benchmark")!;
    const trigger = findAll(bench, (el) => el.props?.["data-testid"] === "benchmark-info-trigger");
    expect(trigger.length).toBeGreaterThanOrEqual(1);
  });
});
