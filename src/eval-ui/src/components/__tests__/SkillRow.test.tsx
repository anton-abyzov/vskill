import { describe, it, expect, vi } from "vitest";
import { SkillRowInner as SkillRow } from "../SkillRow";
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

function makeSkill(origin: "source" | "installed", updateAvailable = false): SkillInfo {
  return {
    plugin: "obsidian-brain",
    skill: "lint",
    dir: origin === "installed" ? "/home/u/.claude/skills/obsidian-brain/lint" : "/home/u/plugins/obsidian-brain/lint",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 2,
    assertionCount: 4,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
    updateAvailable,
  };
}

describe("SkillRow", () => {
  it("has data-selected=true when selected", () => {
    const tree = SkillRow({
      skill: makeSkill("source"),
      isSelected: true,
      onSelect: vi.fn(),
    }) as ReactEl;
    expect(tree.props["data-selected"]).toBe(true);
  });

  it("applies the 1px accent left border when selected", () => {
    const tree = SkillRow({
      skill: makeSkill("source"),
      isSelected: true,
      onSelect: vi.fn(),
    }) as ReactEl;
    const style = tree.props.style as Record<string, string>;
    // Use box-shadow: inset to implement a 1px accent bar per ADR design.
    expect(String(style.boxShadow ?? "") + String(style.borderLeft ?? "")).toMatch(/var\(--color-accent\)|var\(--accent-surface\)/);
  });

  it("renders a dot badge in --status-own for source skills", () => {
    const tree = expand(SkillRow({
      skill: makeSkill("source"),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const dots = findElements(tree, (el) => {
      const s = el.props?.style as Record<string, string> | undefined;
      return !!s?.background && /--status-own/.test(s.background);
    });
    expect(dots.length).toBeGreaterThan(0);
  });

  it("renders a dot badge in --status-installed for installed skills", () => {
    const tree = expand(SkillRow({
      skill: makeSkill("installed"),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    const dots = findElements(tree, (el) => {
      const s = el.props?.style as Record<string, string> | undefined;
      return !!s?.background && /--status-installed/.test(s.background);
    });
    expect(dots.length).toBeGreaterThan(0);
  });

  it("has a 36px row height", () => {
    const tree = SkillRow({
      skill: makeSkill("source"),
      isSelected: false,
      onSelect: vi.fn(),
    }) as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(Number(style.height)).toBe(36);
  });

  it("fires onSelect when clicked", () => {
    const onSelect = vi.fn();
    const tree = SkillRow({
      skill: makeSkill("source"),
      isSelected: false,
      onSelect,
    }) as ReactEl;
    const onClick = tree.props.onClick as () => void;
    onClick();
    expect(onSelect).toHaveBeenCalled();
  });

  it("shows the update-available glyph for installed skills with update", () => {
    const tree = expand(SkillRow({
      skill: makeSkill("installed", true),
      isSelected: false,
      onSelect: vi.fn(),
    }));
    // 0683 T-004 replaces the old "update" pill with a `↑` glyph carrying
    // the stable `skill-row-update-glyph` test id.
    const hits = findElements(tree, (el) => el.props?.["data-testid"] === "skill-row-update-glyph");
    expect(hits.length).toBe(1);
  });
});
