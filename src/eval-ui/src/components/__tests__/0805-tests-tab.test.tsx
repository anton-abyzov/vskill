// ---------------------------------------------------------------------------
// 0805: Restore Tests as a top-level tab (peer of Overview/Edit/Run/History).
//
// Coverage:
// - AC-US1-01: source skills see Overview | Edit | Tests | Run | History
// - AC-US1-04: installed skills see Overview | Tests | Run | History (Edit hidden)
// - AC-US1-05: legacy `?tab=tests` mounts the Tests tab itself (was a
//   redirect to `?tab=run&mode=benchmark` post-0792)
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
vi.mock("../../pages/workspace/TestsPanel", () => ({
  TestsPanel: () => null,
}));
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

import { RightPanel, readInitialTabFromSearch, resolveLegacyTab } from "../RightPanel";
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

describe("RightPanel — 0804 Tests as top-level tab", () => {
  it("source skills get 5 tabs in order: Overview | Edit | Tests | Run | History", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-edit",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-history",
    ]);
  });

  it("installed skills see Tests as a top-level tab (Edit hidden, Tests + Run visible)", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-history",
    ]);
  });

  it("?tab=tests resolves to the Tests tab itself (no longer redirects to run/benchmark)", () => {
    expect(readInitialTabFromSearch("?tab=tests")).toEqual({ tab: "tests" });
    expect(resolveLegacyTab("tests")).toEqual({ tab: "tests" });
  });

  it("?panel=tests (legacy param) also resolves to Tests tab", () => {
    expect(readInitialTabFromSearch("?panel=tests")).toEqual({ tab: "tests" });
  });

  it("activeDetailTab='tests' aria-selects the Tests tab", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "tests",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const activeTab = findAll(tree, (el) => el.props?.role === "tab" && el.props["aria-selected"] === true);
    expect(activeTab.length).toBe(1);
    expect(activeTab[0].props["data-testid"]).toBe("detail-tab-tests");
  });

  it("Tests tab does NOT render a SubTabBar (no sub-modes)", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      activeDetailTab: "tests",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const subBar = findAll(tree, (el) =>
      typeof el.props?.["data-testid"] === "string" &&
      (el.props["data-testid"] as string).startsWith("detail-subtab-bar-"),
    );
    expect(subBar.length).toBe(0);
  });
});
