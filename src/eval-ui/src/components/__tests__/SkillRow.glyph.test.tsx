import { describe, it, expect, vi } from "vitest";
import { SkillRow, SkillRowInner } from "../SkillRow";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
    return expand(rendered);
  }
  if (el.props?.children != null) {
    return { ...el, props: { ...el.props, children: expand(el.props.children) } };
  }
  return el;
}

function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

function baseSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian-brain",
    skill: "lint",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...overrides,
  };
}

describe("SkillRow ↑ glyph (0683 T-004)", () => {
  it("renders a glyph with color var(--color-own) when updateAvailable is true", () => {
    const tree = expand(SkillRowInner({
      skill: baseSkill({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.1.0" }),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const glyphs = findElements(tree, (el) => el.props?.["data-testid"] === "skill-row-update-glyph");
    expect(glyphs).toHaveLength(1);
    const g = glyphs[0];
    const style = g.props.style as Record<string, string>;
    expect(style.color).toBe("var(--color-own)");
    expect(g.props.title).toBe("Update available: 1.0.0 → 1.1.0");
  });

  it("falls back to generic tooltip when latestVersion is null", () => {
    const tree = expand(SkillRowInner({
      skill: baseSkill({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: undefined }),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const glyphs = findElements(tree, (el) => el.props?.["data-testid"] === "skill-row-update-glyph");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].props.title).toBe("Update available");
  });

  it("renders no glyph when updateAvailable is false or undefined", () => {
    const noFlag = expand(SkillRowInner({
      skill: baseSkill(),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const falseFlag = expand(SkillRowInner({
      skill: baseSkill({ updateAvailable: false }),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    expect(findElements(noFlag, (el) => el.props?.["data-testid"] === "skill-row-update-glyph")).toHaveLength(0);
    expect(findElements(falseFlag, (el) => el.props?.["data-testid"] === "skill-row-update-glyph")).toHaveLength(0);
  });

  it("SVG path matches the chevron-up `M12 19V5` contract", () => {
    const tree = expand(SkillRowInner({
      skill: baseSkill({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "2.0.0" }),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const paths = findElements(tree, (el) => el.type === "path" && el.props?.d === "M12 19V5");
    expect(paths.length).toBe(1);
  });

  it("width/height are 10 — subtle per design direction", () => {
    const tree = expand(SkillRowInner({
      skill: baseSkill({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "2.0.0" }),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const svgs = findElements(tree, (el) => el.type === "svg" && el.props?.width === "10");
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs[0].props.height).toBe("10");
  });

  it("SkillRow is exported as a React.memo component", () => {
    // React.memo returns an object with `$$typeof = Symbol.for('react.memo')`
    const anyRow = SkillRow as unknown as { $$typeof?: symbol };
    expect(typeof anyRow.$$typeof).toBe("symbol");
    expect(String(anyRow.$$typeof)).toMatch(/react\.memo/);
  });
});
