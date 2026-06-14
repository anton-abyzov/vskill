// ---------------------------------------------------------------------------
// 0874 / 0848 T-001 — DetailHeader mounts the orphaned PrivateBadge on the
// skill detail header when the skill's source repo is private, so a private
// skill is visibly distinct in the workspace detail pane. Public/unknown
// visibility renders no Private indicator.
//
// Visibility is threaded in as a prop (resolved by RightPanel via
// useSkillRepoVisibility) so DetailHeader stays a pure function — the same
// prop-passing contract SkillRow uses for its PrivateRepoChip.
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

describe("DetailHeader — 0874 private badge", () => {
  it("renders the PrivateBadge (data-private) when repoVisibility is 'private'", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill, repoVisibility: "private", tenantName: "acme-corp" });
    const badges = findAll(tree, (el) => el.props?.["data-private"] === "true");
    expect(badges.length).toBe(1);
    const text = collectText(badges[0]).replace(/\s+/g, " ").trim();
    expect(text).toMatch(/Private/);
    expect(text).toMatch(/acme-corp/);
  });

  it("renders NO private badge when repoVisibility is 'public'", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill, repoVisibility: "public" });
    const badges = findAll(tree, (el) => el.props?.["data-private"] === "true");
    expect(badges.length).toBe(0);
  });

  it("renders NO private badge when repoVisibility is omitted (unknown)", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill });
    const badges = findAll(tree, (el) => el.props?.["data-private"] === "true");
    expect(badges.length).toBe(0);
  });
});
