// ---------------------------------------------------------------------------
// 0781 AC-US1-01/03: SkillRow renders the installed (lockfile/registry) version
// for `origin === "installed"` skills, even when the on-disk frontmatter has
// drifted past it. For `origin === "own"` (authored) skills, frontmatter wins.
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

function baseSkill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: "plug",
    skill: "greet-anton",
    dir: "/tmp/skill",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    ...overrides,
  };
}

function readBadgeVersion(skill: SkillInfo): string | null {
  const tree = SkillRow({ skill, isSelected: false, onSelect: () => {} });
  const badges = findAll(tree, (el) => typeof el.props?.["data-version"] === "string");
  if (badges.length === 0) return null;
  return String(badges[0].props["data-version"]);
}

describe("SkillRow — 0781 installed-version preference", () => {
  it("AC-US1-01: installed skill — resolvedVersion (1.0.2 from lockfile) wins over frontmatter (1.0.3)", () => {
    // The resolver in api.ts sets resolvedVersion before this component
    // renders — for installed scope it picks currentVersion, not the
    // frontmatter `version`. Simulate that contract here.
    const skill = baseSkill({
      origin: "installed",
      version: "1.0.3",          // on-disk frontmatter (drifted)
      currentVersion: "1.0.2",   // lockfile / platform truth
      resolvedVersion: "1.0.2",  // what the resolver hands us
      versionSource: "registry",
    });
    expect(readBadgeVersion(skill)).toBe("1.0.2");
  });

  it("AC-US1-03: own skill — frontmatter (1.0.3) still wins", () => {
    const skill = baseSkill({
      origin: "source",
      version: "1.0.3",
      currentVersion: "1.0.2",
      resolvedVersion: "1.0.3",
      versionSource: "frontmatter",
    });
    expect(readBadgeVersion(skill)).toBe("1.0.3");
  });
});
