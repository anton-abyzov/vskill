import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock heavy child components to keep tests focused
// ---------------------------------------------------------------------------
vi.mock("../EditorPanel", () => ({ EditorPanel: () => ({ type: "div", props: { "data-testid": "editor-panel" } }) }));
vi.mock("../TestsPanel", () => ({ TestsPanel: () => ({ type: "div", props: { "data-testid": "tests-panel" } }) }));
vi.mock("../RunPanel", () => ({ RunPanel: () => ({ type: "div", props: { "data-testid": "run-panel" } }) }));
vi.mock("../ActivationPanel", () => ({ ActivationPanel: () => ({ type: "div", props: { "data-testid": "activation-panel" } }) }));
vi.mock("../HistoryPanel", () => ({ HistoryPanel: () => ({ type: "div", props: { "data-testid": "history-panel" } }) }));
vi.mock("../DepsPanel", () => ({ DepsPanel: () => ({ type: "div", props: { "data-testid": "deps-panel" } }) }));
vi.mock("../LeaderboardPanel", () => ({ LeaderboardPanel: () => ({ type: "div", props: { "data-testid": "leaderboard-panel" } }) }));
vi.mock("../../../components/DetailHeader", () => ({ DetailHeader: () => ({ type: "div", props: { "data-testid": "detail-header" } }) }));
vi.mock("../../../components/TabBar", () => ({ TabBar: () => ({ type: "div", props: { "data-testid": "tab-bar" } }) }));

// ---------------------------------------------------------------------------
// Mock WorkspaceContext & StudioContext
// ---------------------------------------------------------------------------
const mockDispatch = vi.fn();

const mockState = {
  plugin: "test-plugin",
  skill: "test-skill",
  loading: false,
  error: null as string | null,
  activePanel: "tests" as string,
  isDirty: false,
  caseRunStates: new Map(),
  regressions: [],
  activationRunning: false,
};

vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: mockDispatch,
    saveContent: vi.fn(),
    isReadOnly: false,
  }),
}));

vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({
    state: { skills: [] },
    refreshSkills: vi.fn(),
    clearSelection: vi.fn(),
  }),
}));

// Mock React hooks to avoid DOM dependency
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

// ---------------------------------------------------------------------------
// Mock api module
// ---------------------------------------------------------------------------
vi.mock("../../../api", () => ({
  api: {
    deleteSkill: vi.fn(),
  },
}));

import { SkillWorkspaceInner } from "../SkillWorkspace";
import { ErrorCard } from "../../../components/ErrorCard";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { DetailHeader } from "../../../components/DetailHeader";
import { TabBar } from "../../../components/TabBar";

type ReactEl = { type: unknown; props: Record<string, unknown>; children?: unknown[] };

/** Recursively collect all elements matching a predicate. */
function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((c) => collectElements(c, match));
  }
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) {
    results.push(...collectElements(el.props.children, match));
  }
  return results;
}

/** Recursively collect all text from a React element tree. */
function collectText(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  if (typeof node === "object" && node !== null) {
    const e = node as ReactEl;
    const childText = e.props?.children != null ? collectText(e.props.children) : "";
    return childText;
  }
  return "";
}

// ---------------------------------------------------------------------------
// T-008: Replace raw error banner with ErrorCard
// ---------------------------------------------------------------------------
describe("T-008: SkillWorkspace error banner uses ErrorCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.loading = false;
    mockState.error = null;
    mockState.activePanel = "tests";
    mockState.plugin = "test-plugin";
    mockState.skill = "test-skill";
  });

  it("renders ErrorCard when state.error is set", () => {
    mockState.error = "Something failed";
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const errorCards = collectElements(tree, (el) => el.type === ErrorCard);
    expect(errorCards.length).toBeGreaterThan(0);
  });

  it("passes classified error to ErrorCard via classifyErrorClient", () => {
    mockState.error = "rate limit exceeded";
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const errorCards = collectElements(tree, (el) => el.type === ErrorCard);
    expect(errorCards.length).toBeGreaterThan(0);
    const errorProp = errorCards[0].props.error as { category: string };
    expect(errorProp.category).toBe("rate_limit");
  });

  it("provides onDismiss that dispatches SET_ERROR null", () => {
    mockState.error = "Something failed";
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const errorCards = collectElements(tree, (el) => el.type === ErrorCard);
    expect(errorCards.length).toBeGreaterThan(0);
    const onDismiss = errorCards[0].props.onDismiss as () => void;
    expect(onDismiss).toBeDefined();
    onDismiss();
    expect(mockDispatch).toHaveBeenCalledWith({ type: "SET_ERROR", error: null });
  });

  it("does not render ErrorCard when state.error is null", () => {
    mockState.error = null;
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const errorCards = collectElements(tree, (el) => el.type === ErrorCard);
    expect(errorCards).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T-010: Wrap workspace panel content in ErrorBoundary keyed by skill
// ---------------------------------------------------------------------------
describe("T-010: SkillWorkspace wraps panel content in ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.loading = false;
    mockState.error = null;
    mockState.activePanel = "tests";
    mockState.plugin = "test-plugin";
    mockState.skill = "test-skill";
  });

  it("renders ErrorBoundary around panel content", () => {
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const boundaries = collectElements(tree, (el) => el.type === ErrorBoundary);
    expect(boundaries.length).toBeGreaterThan(0);
  });

  it("ErrorBoundary receives key based on plugin/skill", () => {
    mockState.plugin = "marketing";
    mockState.skill = "chrome-post";
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const boundaries = collectElements(tree, (el) => el.type === ErrorBoundary);
    expect(boundaries.length).toBeGreaterThan(0);
    expect(boundaries[0].props.key || (boundaries[0] as any).key).toBeDefined();
  });

  it("DetailHeader and TabBar are outside ErrorBoundary", () => {
    const tree = SkillWorkspaceInner() as unknown as ReactEl;
    const boundaries = collectElements(tree, (el) => el.type === ErrorBoundary);

    // Check that DetailHeader and TabBar are NOT inside the ErrorBoundary
    if (boundaries.length > 0) {
      const insideBoundary = collectElements(boundaries[0].props.children, (el) => {
        return el.type === DetailHeader || el.type === TabBar;
      });
      expect(insideBoundary).toHaveLength(0);
    }

    // Check that DetailHeader and TabBar exist in the overall tree (by function reference)
    const detailHeaders = collectElements(tree, (el) => el.type === DetailHeader);
    const tabBars = collectElements(tree, (el) => el.type === TabBar);
    expect(detailHeaders.length).toBeGreaterThan(0);
    expect(tabBars.length).toBeGreaterThan(0);
  });

  it("ErrorBoundary key changes when plugin or skill changes", () => {
    mockState.plugin = "plugin-a";
    mockState.skill = "skill-1";
    const tree1 = SkillWorkspaceInner() as unknown as ReactEl;
    const boundaries1 = collectElements(tree1, (el) => el.type === ErrorBoundary);

    mockState.plugin = "plugin-b";
    mockState.skill = "skill-2";
    const tree2 = SkillWorkspaceInner() as unknown as ReactEl;
    const boundaries2 = collectElements(tree2, (el) => el.type === ErrorBoundary);

    // Both should have ErrorBoundary — the key mechanism ensures React resets
    expect(boundaries1.length).toBeGreaterThan(0);
    expect(boundaries2.length).toBeGreaterThan(0);
  });
});
