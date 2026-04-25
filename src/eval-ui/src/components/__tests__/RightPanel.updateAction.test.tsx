import { describe, it, expect, vi } from "vitest";

// Stub React hooks — the existing detail-right-panel.test.tsx uses the
// same pattern so RightPanel can be exercised as a pure function.
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

vi.mock("../../pages/workspace/SkillWorkspace", () => ({ SkillWorkspaceInner: () => null }));
vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({ VersionHistoryPanel: () => null }));
vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: unknown }) => children as never,
  useWorkspace: () => ({}),
}));
vi.mock("../../pages/UpdatesPanel", () => ({ UpdatesPanel: () => null }));
vi.mock("../CreateSkillInline", () => ({ CreateSkillInline: () => null }));

// RightPanel's Workspace sub-tree consumes StudioContext; stub so we can
// render without a provider tree.
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

vi.mock("../CheckNowButton", () => ({
  CheckNowButton: () => null,
}));

// Replace UpdateAction with a stub so this test only verifies mount ordering.
vi.mock("../UpdateAction", () => ({
  UpdateAction: ({ skill }: { skill: import("../../types").SkillInfo | null }) => {
    if (!skill || skill.updateAvailable !== true) return null;
    return {
      type: "div",
      props: {
        "data-testid": "update-action-stub",
        "data-latest": skill.latestVersion ?? "",
      },
    } as unknown;
  },
}));

import { RightPanel } from "../RightPanel";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
    return expand(rendered);
  }
  if (el.props?.children != null) {
    return { ...el, props: { ...el.props, children: expand(el.props.children) } };
  }
  return el;
}

function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

function makeSkill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: "plugin-a",
    skill: "skill-x",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...overrides,
  };
}

describe("RightPanel — UpdateAction mount (0683 T-010)", () => {
  it("renders the UpdateAction stub when the selected skill is outdated", () => {
    const skill = makeSkill({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.2.0" });
    const tree = expand(RightPanel({ selectedSkillInfo: skill }));
    const stubs = findElements(tree, (el) => el.props?.["data-testid"] === "update-action-stub");
    expect(stubs).toHaveLength(1);
    expect(stubs[0].props["data-latest"]).toBe("1.2.0");
  });

  it("renders no UpdateAction block when no update is available", () => {
    const skill = makeSkill({ updateAvailable: false });
    const tree = expand(RightPanel({ selectedSkillInfo: skill }));
    const stubs = findElements(tree, (el) => el.props?.["data-testid"] === "update-action-stub");
    expect(stubs).toHaveLength(0);
  });
});
