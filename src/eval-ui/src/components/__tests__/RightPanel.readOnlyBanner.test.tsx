// ---------------------------------------------------------------------------
// RED: RightPanel detail shell must render a read-only banner
// (data-testid="read-only-banner") when the selected skill is "installed"
// (read-only). Banner explains the skill is an installed copy and source
// must be edited instead.
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
vi.mock("../CheckNowButton", () => ({ CheckNowButton: () => null }));

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

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "anton-abyzov",
    skill: "greet-anton",
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

describe("RightPanel — read-only banner", () => {
  it("renders banner with data-testid='read-only-banner' for installed skills", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const banners = findAll(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners.length).toBeGreaterThanOrEqual(1);
  });

  it("banner mentions 'installed' and 'source' so users know what to do", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "installed" }) });
    const banners = findAll(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners.length).toBeGreaterThanOrEqual(1);
    const text = collectText(banners[0]).toLowerCase();
    expect(text).toMatch(/installed/);
    expect(text).toMatch(/source/);
  });

  it("does NOT render banner when origin is 'source'", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill({ origin: "source" }) });
    const banners = findAll(tree, (el) => el.props?.["data-testid"] === "read-only-banner");
    expect(banners).toHaveLength(0);
  });
});
