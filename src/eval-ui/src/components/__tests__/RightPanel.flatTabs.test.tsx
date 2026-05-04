// ---------------------------------------------------------------------------
// 0792 T-013: RightPanel — 4-tab IA layout (Overview/Edit/Run/History)
//
// Replaces the prior 6-tab test (0707 T-007 / 0769 Part B). Every test that
// asserted "Tests / Trigger / Versions" as top-level tabs has been rewritten
// to expect the new 4-tab IA. Sub-tab assertions cover the new mode/view
// descriptors under Run and History.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => [init, () => {}],
    useEffect: () => {},
    useRef: (init: unknown) => ({ current: init }),
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useReducer: (_r: unknown, init: unknown) => [init, () => {}],
  };
});

// Stub sub-components so we can walk the tree without mounting the real
// workspace panel machinery.
vi.mock("../../pages/workspace/EditorPanel", () => ({ EditorPanel: () => null }));
vi.mock("../../pages/workspace/RunDispatcherPanel", () => ({
  RunDispatcherPanel: () => null,
  isValidRunMode: (v: unknown) => v === "benchmark" || v === "activation" || v === "ab",
}));
vi.mock("../../pages/workspace/HistoryShell", () => ({
  HistoryShell: () => null,
  isValidHistoryView: (v: unknown) => v === "timeline" || v === "models" || v === "versions",
}));
vi.mock("../../pages/workspace/ActivationPanel", () => ({ ActivationPanel: () => null }));
vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: unknown }) => children as never,
  useWorkspace: () => ({ state: { activePanel: "editor" }, dispatch: () => {} }),
}));
vi.mock("../../pages/UpdatesPanel", () => ({ UpdatesPanel: () => null }));
vi.mock("../CreateSkillInline", () => ({ CreateSkillInline: () => null }));
vi.mock("../UpdateAction", () => ({ UpdateAction: () => null }));

vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    state: {
      selectedSkill: null,
      mode: "browse",
      searchQuery: "",
      skills: [],
      skillsLoading: false,
      skillsError: null,
      isMobile: false,
      mobileView: "list",
      updateNotificationDismissed: false,
    },
    selectSkill: () => {},
    clearSelection: () => {},
    setMode: () => {},
    setSearch: () => {},
    refreshSkills: () => {},
    setMobileView: () => {},
  }),
}));

import { RightPanel } from "../RightPanel";
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
      /* ignore */
    }
  }
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "easychamp",
    skill: "tournament-manager",
    dir: "/tmp/plugins/easychamp/skills/tournament-manager",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 3,
    assertionCount: 9,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01T12:00:00Z",
    origin: "source",
    version: "0.1.0",
    author: "Anton Abyzov",
    homepage: "https://github.com/anton-abyzov/easychamp-mcp",
    lastModified: "2026-04-24T10:00:00Z",
    sizeBytes: 4096,
    ...over,
  };
}

describe("RightPanel — 6-tab IA (0823 — Source added; 0805 — Tests promoted back; 0792 T-013 was 4-tab)", () => {
  it("renders exactly 6 tabs (Overview/Source/Edit/Tests/Run/History) for source-origin skills", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-source",
      "detail-tab-edit",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-history",
    ]);
    const tablist = findAll(tree, (el) => el.props?.role === "tablist")[0];
    expect(tablist).toBeDefined();
  });

  it("hides Edit for installed-origin (consumer) skills, leaving Overview/Source/Tests/Run/History", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-source",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-history",
    ]);
  });

  it("does not surface 'Trigger' or 'Versions' as top-level tabs anymore (Tests is now top-level via 0805)", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toContain("detail-tab-tests");
    expect(ids).not.toContain("detail-tab-activation");
    expect(ids).not.toContain("detail-tab-versions");
    expect(ids).not.toContain("detail-tab-trigger");
  });

  it("marks the default active tab as 'overview' and renders SkillOverview", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const activeTab = findAll(tree, (el) => el.props?.role === "tab" && el.props["aria-selected"] === true);
    expect(activeTab.length).toBe(1);
    expect(activeTab[0].props["data-testid"]).toBe("detail-tab-overview");
    const overview = findAll(tree, (el) => el.props?.["data-testid"] === "skill-overview");
    expect(overview.length).toBeGreaterThanOrEqual(1);
  });

  it("respects activeDetailTab prop for non-overview tabs", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "edit",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const activeTab = findAll(tree, (el) => el.props?.role === "tab" && el.props["aria-selected"] === true);
    expect(activeTab[0].props["data-testid"]).toBe("detail-tab-edit");
    const overview = findAll(tree, (el) => el.props?.["data-testid"] === "skill-overview");
    expect(overview.length).toBe(0);
  });

  it("renders the Run SubTabBar (Benchmark/Activation/A/B) when activeDetailTab='run'", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "run",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subBar = findAll(tree, (el) => el.props?.["data-testid"] === "detail-subtab-bar-run");
    expect(subBar.length).toBe(1);
    const subTabs = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-run-"),
    );
    expect(subTabs.length).toBe(3);
    const ids = subTabs.map((t) => t.props["data-testid"]);
    expect(ids).toEqual([
      "detail-subtab-run-benchmark",
      "detail-subtab-run-activation",
      "detail-subtab-run-ab",
    ]);
  });

  it("renders the History SubTabBar (Timeline/Models/Versions) when activeDetailTab='history'", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "history",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subBar = findAll(tree, (el) => el.props?.["data-testid"] === "detail-subtab-bar-history");
    expect(subBar.length).toBe(1);
    const subTabs = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-history-"),
    );
    expect(subTabs.length).toBe(3);
    const ids = subTabs.map((t) => t.props["data-testid"]);
    expect(ids).toEqual([
      "detail-subtab-history-timeline",
      "detail-subtab-history-models",
      "detail-subtab-history-versions",
    ]);
  });

  it("does NOT render a SubTabBar when activeDetailTab='edit' (no sub-modes)", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "edit",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subBar = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-bar-"),
    );
    expect(subBar.length).toBe(0);
  });

  it("does NOT render a SubTabBar when activeDetailTab='overview'", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "overview",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subBar = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-bar-"),
    );
    expect(subBar.length).toBe(0);
  });

  // 0792 PLAN_CORRECTION: regression guard — production wires sub state
  // through the prop-driven path. The earlier draft owned sub state inside
  // IntegratedDetailShell, which is unreachable when App always supplies
  // `selectedSkillInfo`; that made every Run mode chip / History view chip
  // a silent no-op. These tests pin the new contract: the activeDetailSub
  // prop drives which sub-tab is aria-selected, and clicking a sub-tab
  // invokes onDetailSubChange with the descriptor id.
  it("activeDetailSub controls which Run sub-tab is aria-selected", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "run",
      activeDetailSub: "activation",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subTabs = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-run-"),
    );
    const selected = subTabs.find((t) => t.props["aria-selected"] === true);
    expect(selected?.props["data-testid"]).toBe("detail-subtab-run-activation");
  });

  it("activeDetailSub controls which History sub-tab is aria-selected", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "history",
      activeDetailSub: "models",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subTabs = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-history-"),
    );
    const selected = subTabs.find((t) => t.props["aria-selected"] === true);
    expect(selected?.props["data-testid"]).toBe("detail-subtab-history-models");
  });

  it("clicking a Run sub-tab invokes onDetailSubChange with the mode id", () => {
    const onSubChange = vi.fn();
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "run",
      activeDetailSub: "benchmark",
      onDetailSubChange: onSubChange,
      allSkills: [],
      onSelectSkill: () => {},
    });
    const activationTab = findAll(tree, (el) =>
      el.props?.["data-testid"] === "detail-subtab-run-activation",
    )[0];
    expect(activationTab).toBeDefined();
    (activationTab.props.onClick as () => void)();
    expect(onSubChange).toHaveBeenCalledWith("activation");
  });

  it("clicking a History sub-tab invokes onDetailSubChange with the view id", () => {
    const onSubChange = vi.fn();
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "history",
      activeDetailSub: "timeline",
      onDetailSubChange: onSubChange,
      allSkills: [],
      onSelectSkill: () => {},
    });
    const versionsTab = findAll(tree, (el) =>
      el.props?.["data-testid"] === "detail-subtab-history-versions",
    )[0];
    expect(versionsTab).toBeDefined();
    (versionsTab.props.onClick as () => void)();
    expect(onSubChange).toHaveBeenCalledWith("versions");
  });

  // Regression guard for the silent-no-op bug surfaced in PLAN_CORRECTION:
  // when no onDetailSubChange handler is provided, clicking a sub-tab
  // hits SubTabBar's dev-warn default (T-016) rather than crashing or
  // mutating state. This test pairs with the click-tests above to bracket
  // both wired and unwired paths.
  it("clicking a sub-tab without onDetailSubChange does not throw", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "run",
      activeDetailSub: "benchmark",
      // intentionally omit onDetailSubChange
      allSkills: [],
      onSelectSkill: () => {},
    });
    const activationTab = findAll(tree, (el) =>
      el.props?.["data-testid"] === "detail-subtab-run-activation",
    )[0];
    expect(activationTab).toBeDefined();
    // Don't assert on console.warn here — that's covered in
    // SubTabBar.test.tsx. Just confirm the click is a safe no-op rather
    // than an exception, so a missing handler is observable, not fatal.
    expect(() => (activationTab.props.onClick as () => void)()).not.toThrow();
  });
});
