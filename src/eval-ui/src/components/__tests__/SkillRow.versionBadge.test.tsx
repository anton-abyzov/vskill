// ---------------------------------------------------------------------------
// T-009 (0707): SkillRow uses the reusable VersionBadge component
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { SkillRowInner as SkillRow } from "../SkillRow";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

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
    } catch { /* ignore */ }
  }
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(version: string): SkillInfo {
  return {
    plugin: "plug",
    skill: "skill-" + version,
    dir: "/tmp/skill",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    version,
  };
}

describe("SkillRow — T-009 VersionBadge integration", () => {
  it("renders a VersionBadge (data-testid='skill-row-version') for each version", () => {
    for (const version of ["1.0.0", "2.1.3", "0.1.0"]) {
      const tree = SkillRow({ skill: makeSkill(version), isSelected: false, onSelect: () => {} });
      const badges = findAll(tree, (el) => el.props?.["data-testid"] === "skill-row-version");
      expect(badges.length).toBeGreaterThanOrEqual(1);
      // Find the inner rendered span (it carries data-version).
      const withDataVersion = badges.find((b) => typeof b.props["data-version"] === "string");
      expect(withDataVersion).toBeDefined();
      expect(String(withDataVersion!.props["data-version"])).toBe(version);
    }
  });

  // Increment 0750: SkillRow now always renders the version badge — the
  // null-when-missing branch was removed in favor of a "0.0.0" italic
  // default so the AVAILABLE sidebar never has blank slots.
  it("0750: renders a default '0.0.0' badge when skill.version (and resolved) are missing", () => {
    const { version, ...rest } = makeSkill("1.0.0");
    void version;
    const tree = SkillRow({ skill: rest as SkillInfo, isSelected: false, onSelect: () => {} });
    const badges = findAll(tree, (el) => el.props?.["data-testid"] === "skill-row-version");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("0750: passes versionSource through to VersionBadge for source-aware styling", () => {
    const skill: SkillInfo = {
      ...makeSkill("2.3.0"),
      resolvedVersion: "2.3.0",
      versionSource: "plugin",
      pluginName: "specweave",
    };
    const tree = SkillRow({ skill, isSelected: false, onSelect: () => {} });
    // Find the rendered <span> carrying data-version (the inner badge after
    // VersionBadge runs). It must have title prop with the plugin tooltip.
    const badges = findAll(tree, (el) => typeof el.props?.["data-version"] === "string");
    const withTitle = badges.find((b) => typeof b.props.title === "string");
    expect(withTitle).toBeDefined();
    expect(String(withTitle!.props.title)).toMatch(/Inherited from .* plugin v2\.3\.0/);
  });
});
