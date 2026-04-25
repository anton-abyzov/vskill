// ---------------------------------------------------------------------------
// 0708 T-043/T-044 wrap-up: CheckNowButton must be wired into the RightPanel
// detail shell so the rescan button is reachable from the Studio detail view.
//
// Strategy: same function-call rendering pattern as RightPanel.flatTabs —
// mount the panel as a pure call, walk the tree, and assert presence/absence
// of the canonical `data-testid="check-now-button"`.
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
    useContext: () => ({}),
  };
});

vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({ VersionHistoryPanel: () => null }));
vi.mock("../../pages/workspace/EditorPanel", () => ({ EditorPanel: () => null }));
vi.mock("../../pages/workspace/TestsPanel", () => ({ TestsPanel: () => null }));
vi.mock("../../pages/workspace/RunPanel", () => ({ RunPanel: () => null }));
vi.mock("../../pages/workspace/ActivationPanel", () => ({ ActivationPanel: () => null }));
vi.mock("../../pages/workspace/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../../pages/workspace/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("../../pages/workspace/DepsPanel", () => ({ DepsPanel: () => null }));
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
    updatesById: new Map(),
    pushUpdateCount: 0,
    updateStreamStatus: "fallback",
    dismissPushUpdate: () => {},
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
    plugin: "anthropic-skills",
    skill: "pdf",
    dir: "/tmp/p/s",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...over,
  };
}

describe("RightPanel — CheckNowButton wire-up (0708 wrap-up)", () => {
  it("renders CheckNowButton (testid=check-now-button) for tracked skills", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill({ trackedForUpdates: true }),
    });
    const btns = findAll(tree, (el) => el.props?.["data-testid"] === "check-now-button");
    expect(btns.length).toBeGreaterThanOrEqual(1);
  });

  it("does not render CheckNowButton when trackedForUpdates is false", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill({ trackedForUpdates: false }),
    });
    const btns = findAll(tree, (el) => el.props?.["data-testid"] === "check-now-button");
    expect(btns).toHaveLength(0);
  });
});
