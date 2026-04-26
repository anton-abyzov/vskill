// ---------------------------------------------------------------------------
// RED test: when the workspace is in read-only mode (origin === "installed"),
// SkillWorkspace must render a visible banner above the tab bar explaining
// the skill is an installed copy and the source must be edited instead.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../EditorPanel", () => ({ EditorPanel: () => ({ type: "div", props: { "data-testid": "editor-panel" } }) }));
vi.mock("../TestsPanel", () => ({ TestsPanel: () => ({ type: "div", props: { "data-testid": "tests-panel" } }) }));
vi.mock("../RunPanel", () => ({ RunPanel: () => ({ type: "div", props: { "data-testid": "run-panel" } }) }));
vi.mock("../ActivationPanel", () => ({ ActivationPanel: () => ({ type: "div", props: { "data-testid": "activation-panel" } }) }));
vi.mock("../HistoryPanel", () => ({ HistoryPanel: () => ({ type: "div", props: { "data-testid": "history-panel" } }) }));
vi.mock("../DepsPanel", () => ({ DepsPanel: () => ({ type: "div", props: { "data-testid": "deps-panel" } }) }));
vi.mock("../LeaderboardPanel", () => ({ LeaderboardPanel: () => ({ type: "div", props: { "data-testid": "leaderboard-panel" } }) }));
vi.mock("../VersionHistoryPanel", () => ({ VersionHistoryPanel: () => ({ type: "div", props: { "data-testid": "versions-panel" } }) }));
vi.mock("../../../components/DetailHeader", () => ({ DetailHeader: () => ({ type: "div", props: { "data-testid": "detail-header" } }) }));
vi.mock("../../../components/TabBar", () => ({ TabBar: () => ({ type: "div", props: { "data-testid": "tab-bar" } }) }));

const mockDispatch = vi.fn();

const mockState = {
  plugin: "anton-abyzov",
  skill: "greet-anton",
  loading: false,
  error: null as string | null,
  activePanel: "tests" as string,
  isDirty: false,
  caseRunStates: new Map(),
  regressions: [],
  activationRunning: false,
};

let mockIsReadOnly = true;

vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: mockDispatch,
    saveContent: vi.fn(),
    get isReadOnly() {
      return mockIsReadOnly;
    },
  }),
}));

vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({
    state: { skills: [] },
    refreshSkills: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
  };
});

vi.mock("../../../api", () => ({ api: { deleteSkill: vi.fn() } }));

import { SkillWorkspaceInner } from "../SkillWorkspace";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => collectElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...collectElements(el.props.children, match));
  return results;
}

function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object") {
    const e = node as ReactEl;
    return e.props?.children != null ? collectText(e.props.children) : "";
  }
  return "";
}

describe("SkillWorkspace — read-only banner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.loading = false;
    mockState.error = null;
    mockState.activePanel = "tests";
  });

  it("renders a banner with data-testid='read-only-banner' when isReadOnly=true", () => {
    mockIsReadOnly = true;
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const banners = collectElements(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners.length).toBe(1);
  });

  it("banner text mentions 'installed' and points users to edit the source", () => {
    mockIsReadOnly = true;
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const banners = collectElements(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners.length).toBe(1);
    const text = collectText(banners[0]).toLowerCase();
    expect(text).toMatch(/installed/);
    expect(text).toMatch(/source/);
  });

  it("does NOT render the banner when isReadOnly=false", () => {
    mockIsReadOnly = false;
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const banners = collectElements(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners).toHaveLength(0);
  });
});
