// ---------------------------------------------------------------------------
// 0800 [RED] — Overview "N tests" chip.
//
// US-001 / AC-US1-01: a small "N tests" chip is rendered next to the skill
// metadata when evalCount > 0; clicking the chip navigates to the Run tab
// in benchmark mode.
//
// US-001 / AC-US1-06 + AC-US2-07: chip visibility derives from `hasEvals`
// (and evalCount > 0) — visible for both source and installed skills.
//
// Strategy: mirror SkillOverview.test.tsx (pre-existing) — render via a
// function-call walk, find by data-testid="overview-tests-chip".
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
      // ignore render errors
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
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "anton-abyzov",
    skill: "greet-anton",
    dir: "/tmp/p/s",
    hasEvals: true,
    hasBenchmark: false,
    evalCount: 5,
    assertionCount: 20,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    ...over,
  } as SkillInfo;
}

describe("SkillOverview — 'N tests' chip (0800)", () => {
  it("AC-US1-01: chip rendered with text 'N tests' and testid when hasEvals && evalCount > 0", () => {
    const skill = makeSkill({ hasEvals: true, evalCount: 5 });
    const tree = SkillOverview({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "overview-tests-chip");
    expect(chips.length).toBe(1);
    expect(collectText(chips[0])).toMatch(/5\s*tests/i);
  });

  it("AC-US1-01: chip click invokes onNavigate('run') so URL becomes ?tab=run&mode=benchmark", () => {
    const onNavigate = vi.fn();
    const skill = makeSkill({ hasEvals: true, evalCount: 3 });
    const tree = SkillOverview({ skill, onNavigate });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "overview-tests-chip");
    expect(chips.length).toBe(1);
    const onClick = chips[0].props.onClick as (() => void) | undefined;
    expect(onClick).toBeTypeOf("function");
    onClick!();
    expect(onNavigate).toHaveBeenCalledWith("run");
  });

  it("AC-US1-06: chip NOT rendered when hasEvals=false", () => {
    const skill = makeSkill({ hasEvals: false, evalCount: 0 });
    const tree = SkillOverview({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "overview-tests-chip");
    expect(chips).toHaveLength(0);
  });

  it("AC-US1-06: chip NOT rendered when evalCount=0 (envelope present, list empty)", () => {
    const skill = makeSkill({ hasEvals: true, evalCount: 0 });
    const tree = SkillOverview({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "overview-tests-chip");
    expect(chips).toHaveLength(0);
  });

  it("AC-US2-07: chip rendered for installed skills with evals (Run tab access for consumers)", () => {
    const skill = makeSkill({ origin: "installed", hasEvals: true, evalCount: 2 });
    const tree = SkillOverview({ skill });
    const chips = findAll(tree, (el) => el.props?.["data-testid"] === "overview-tests-chip");
    expect(chips.length).toBe(1);
    expect(collectText(chips[0])).toMatch(/2\s*tests/i);
  });
});
