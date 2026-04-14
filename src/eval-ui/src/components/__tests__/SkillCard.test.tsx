// ---------------------------------------------------------------------------
// Unit tests for SkillCard version badge (T-016)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { SkillCard } from "../SkillCard.js";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/** Recursively collect all text content from a React element tree. */
function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

/** Recursively find all React elements matching a predicate. */
function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

function makeSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "test-plugin",
    skill: "test-skill",
    dir: "/tmp",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 5,
    assertionCount: 10,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-01-01",
    origin: "source",
    ...overrides,
  };
}

describe("SkillCard version badge", () => {
  it("renders yellow pill badge when updateAvailable is true", () => {
    const skill = makeSkill({ updateAvailable: true, latestVersion: "1.0.3" });
    const tree = SkillCard({ skill, isSelected: false, onSelect: () => {} });

    const text = collectText(tree);
    expect(text).toContain("1.0.3");

    // Find badge element with yellow styling
    const badges = findElements(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && style.color === "var(--yellow)" && style.background === "var(--yellow-muted)";
    });
    expect(badges.length).toBeGreaterThan(0);
  });

  it("renders nothing when updateAvailable is false", () => {
    const skill = makeSkill({ updateAvailable: false, latestVersion: "1.0.0" });
    const tree = SkillCard({ skill, isSelected: false, onSelect: () => {} });

    const badges = findElements(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && style.color === "var(--yellow)" && style.background === "var(--yellow-muted)";
    });
    expect(badges.length).toBe(0);
  });

  it("renders nothing when updateAvailable is undefined", () => {
    const skill = makeSkill(); // no version fields
    const tree = SkillCard({ skill, isSelected: false, onSelect: () => {} });

    const badges = findElements(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && style.color === "var(--yellow)" && style.background === "var(--yellow-muted)";
    });
    expect(badges.length).toBe(0);
  });

  it("includes an up-arrow SVG in the badge", () => {
    const skill = makeSkill({ updateAvailable: true, latestVersion: "2.0.0" });
    const tree = SkillCard({ skill, isSelected: false, onSelect: () => {} });

    // Find SVGs nested inside yellow-styled elements
    const badges = findElements(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && style.color === "var(--yellow)";
    });
    const svgs = badges.flatMap((b) => findElements(b, (el) => el.type === "svg"));
    expect(svgs.length).toBeGreaterThan(0);
  });
});
