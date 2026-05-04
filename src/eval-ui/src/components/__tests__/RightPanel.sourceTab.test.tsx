// 0823 T-019 — RED tests for the new "Source" tab in RightPanel.
// Mirrors the function-call rendering pattern used by RightPanel.flatTabs.test.tsx.
import { describe, expect, it, vi } from "vitest";

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
vi.mock("../SourcePanel", () => ({
  SourcePanel: () => ({ type: "div", props: { "data-testid": "source-panel" } }),
}));

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
    plugin: ".claude",
    skill: "slack-messaging",
    dir: "/Users/anton/.claude/skills/slack-messaging",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "none",
    lastBenchmark: null,
    origin: "installed",
    version: "1.0.0",
    author: "Anthropic",
    homepage: null,
    lastModified: "2026-04-26T18:38:56Z",
    sizeBytes: 11000,
    ...over,
  };
}

describe("RightPanel — Source tab (0823 T-019/T-020)", () => {
  it("AC-US1-01: Source tab is visible BEFORE Edit for source-origin skills", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "source" }) });
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
  });

  it("AC-US1-01: Source tab is visible for installed-origin (read-only) skills (Edit hidden)", () => {
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

  it("AC-US1-05: Edit remains hidden for installed-origin skills (no regression)", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).not.toContain("detail-tab-edit");
  });

  it("AC-US1-06: Source is the active tab when activeDetailTab='source' is passed", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill({ origin: "installed" }),
      activeDetailTab: "source",
    });
    const activeTab = findAll(
      tree,
      (el) => el.props?.role === "tab" && el.props["aria-selected"] === true,
    );
    expect(activeTab.length).toBe(1);
    expect(activeTab[0].props["data-testid"]).toBe("detail-tab-source");
  });

  it("AC-US1-06 (default): defaultLandingTab returns 'source' for read-only personas", async () => {
    // The actual default-landing flip lives in App.tsx (it requires the
    // selected SkillInfo to be loaded so we know the persona). The pure
    // helper is exported so callers + tests can rely on the contract.
    const { defaultLandingTab } = await import("../RightPanel");
    expect(defaultLandingTab(true)).toBe("source");
    expect(defaultLandingTab(false)).toBe("overview");
  });

  it("AC-US1-02: SourcePanel mounts when activeDetailTab='source'", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill({ origin: "installed" }),
      activeDetailTab: "source",
    });
    const sourcePanel = findAll(
      tree,
      (el) => el.props?.["data-testid"] === "source-panel",
    );
    expect(sourcePanel.length).toBeGreaterThanOrEqual(1);
  });
});
