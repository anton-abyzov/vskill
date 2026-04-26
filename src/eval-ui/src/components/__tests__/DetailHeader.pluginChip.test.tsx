// ---------------------------------------------------------------------------
// 0781 AC-US4-01..04: DetailHeader renders a plugin-context chip ("from
// {plugin}@{ver}") for plugin-bundled skills, and omits it otherwise.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { DetailHeader } from "../DetailHeader";
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

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      return collectText(rendered);
    } catch { return ""; }
  }
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "mobile",
    skill: "appstore",
    dir: "/Users/test/plugins/mobile/skills/appstore",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    version: "2.3.2",
    ...over,
  };
}

describe("DetailHeader — 0781 plugin-context chip", () => {
  it("AC-US4-01: renders 'from {plugin}@{ver}' chip when pluginName + pluginVersion are set", () => {
    const skill = makeSkill({
      pluginName: "mobile",
      pluginVersion: "2.3.2",
    });
    const tree = DetailHeader({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-plugin-chip");
    expect(chips.length).toBe(1);
    const text = collectText(chips[0]).replace(/\s+/g, " ").trim();
    // Tolerate spacing differences ("from mobile @ 2.3.2" vs "from mobile@2.3.2").
    expect(text).toMatch(/from\s*mobile\s*@\s*2\.3\.2/);
  });

  it("AC-US4-02: chip is absent when pluginName is null/undefined", () => {
    const skill = makeSkill({ pluginName: null, pluginVersion: null });
    const tree = DetailHeader({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-plugin-chip");
    expect(chips.length).toBe(0);
  });

  it("AC-US4-02: chip is absent when pluginName is set but pluginVersion missing", () => {
    const skill = makeSkill({ pluginName: "mobile", pluginVersion: null });
    const tree = DetailHeader({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-plugin-chip");
    expect(chips.length).toBe(0);
  });

  it("AC-US4-04: VersionBadge for the skill itself still renders alongside the chip", () => {
    const skill = makeSkill({
      pluginName: "mobile",
      pluginVersion: "2.3.2",
      resolvedVersion: "2.3.2",
      versionSource: "frontmatter",
    });
    const tree = DetailHeader({ skill });
    const versionBadges = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-version");
    expect(versionBadges.length).toBe(1);
  });
});
