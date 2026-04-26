// ---------------------------------------------------------------------------
// T-007 (0707): RightPanel — flat 9-tab layout
//
// Verifies that RightPanel now renders a single 9-tab tablist (instead of
// the old 2-tab Overview|Versions pattern). Uses the same function-call
// rendering strategy as the other tests in this folder.
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

describe("RightPanel — persona-conditional tab layout (T-007 + 0769 T-019)", () => {
  it("renders 6 author tabs (no History/Leaderboard/Deps) for source-origin skills", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-editor",
      "detail-tab-tests",
      "detail-tab-run",
      "detail-tab-activation",
      "detail-tab-versions",
    ]);
    const tablist = findAll(tree, (el) => el.props?.role === "tablist")[0];
    expect(tablist).toBeDefined();
  });

  it("renders 3 consumer tabs (Overview/Trigger/Versions only) for installed-origin skills", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-tab-overview",
      "detail-tab-activation",
      "detail-tab-versions",
    ]);
  });

  it("uses the user-facing label 'Trigger' for the activation tab", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const triggerTab = findAll(tree, (el) => el.props?.["data-testid"] === "detail-tab-activation")[0];
    expect(triggerTab).toBeDefined();
    // Children prop is the rendered label string.
    expect(triggerTab.props.children).toBe("Trigger");
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
      activeDetailTab: "tests",
      allSkills: [],
      onSelectSkill: () => {},
    });
    const activeTab = findAll(tree, (el) => el.props?.role === "tab" && el.props["aria-selected"] === true);
    expect(activeTab[0].props["data-testid"]).toBe("detail-tab-tests");
    // Overview body should NOT be mounted when active tab !== overview.
    const overview = findAll(tree, (el) => el.props?.["data-testid"] === "skill-overview");
    expect(overview.length).toBe(0);
  });

  it("no longer embeds SkillWorkspaceInner inside the Overview tab", () => {
    // Sanity: scan for any element whose type display name contains
    // "SkillWorkspaceInner". The component is no longer imported.
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const candidates = findAll(tree, (el) => {
      if (typeof el.type === "function") {
        const name = (el.type as { name?: string }).name ?? "";
        return name.includes("SkillWorkspaceInner");
      }
      return false;
    });
    expect(candidates.length).toBe(0);
  });
});
