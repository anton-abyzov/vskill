// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-063 / 0792 T-013/T-014: top-level tab wiring
//
// History note: the original 0707 IA had "Versions" as its own top-level
// tab. 0792 collapses that into a "History" tab with a Versions view, so
// these tests now verify the new contract:
//
//   - Default active tab is Overview.
//   - Setting activeDetailTab="history" makes the History tab aria-selected.
//   - Clicking the History tab button invokes onDetailTabChange with
//     "history".
//   - With allSkills supplied (integrated mode) the History tab mounts
//     HistoryShell which dispatches to one of three views.
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
vi.mock("../../pages/workspace/HistoryShell", () => ({
  HistoryShell: () =>
    ({ type: "div", props: { "data-testid": "history-shell", children: "History pane" } }) as unknown,
  isValidHistoryView: (v: unknown) => v === "timeline" || v === "models" || v === "versions",
}));
vi.mock("../../pages/workspace/RunDispatcherPanel", () => ({
  RunDispatcherPanel: () => null,
  isValidRunMode: (v: unknown) => v === "benchmark" || v === "activation" || v === "ab",
}));
vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: unknown }) => children as never,
  useWorkspace: () => ({}),
}));
vi.mock("../../pages/UpdatesPanel", () => ({
  UpdatesPanel: () => null,
}));
vi.mock("../CreateSkillInline", () => ({
  CreateSkillInline: () => null,
}));
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

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      return expand(rendered);
    } catch {
      return el;
    }
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
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findElements(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian",
    skill: "obsidian-brain",
    dir: "/Users/test/skills/obsidian-brain",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 5,
    assertionCount: 20,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01T12:00:00Z",
    origin: "source",
    description: "Autonomous Obsidian vault management.",
    version: "1.3.0",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    sourceAgent: null,
    ...over,
  };
}

describe("RightPanel — top-level tab wiring (0792 IA)", () => {
  it("Overview tab is the default when activeDetailTab is not supplied", () => {
    const skill = makeSkill();
    const tree = RightPanel({ selectedSkillInfo: skill });
    const tabs = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && typeof attrs["aria-selected"] === "boolean" && attrs.id === "detail-tab-overview";
    });
    expect(tabs.length).toBe(1);
    expect(tabs[0].props["aria-selected"]).toBe(true);
  });

  it("History tab becomes aria-selected when activeDetailTab='history'", () => {
    const skill = makeSkill();
    const tree = RightPanel({ selectedSkillInfo: skill, activeDetailTab: "history" });
    const historyTab = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && attrs.id === "detail-tab-history";
    })[0];
    expect(historyTab).toBeTruthy();
    expect(historyTab.props["aria-selected"]).toBe(true);
  });

  it("clicking the History tab button invokes onDetailTabChange with 'history'", () => {
    const skill = makeSkill();
    const spy = vi.fn();
    const tree = RightPanel({
      selectedSkillInfo: skill,
      activeDetailTab: "overview",
      onDetailTabChange: spy,
    });
    const historyTab = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && attrs.id === "detail-tab-history";
    })[0];
    expect(historyTab).toBeTruthy();
    (historyTab.props.onClick as () => void)();
    expect(spy).toHaveBeenCalledWith("history");
  });

  it("History tab panel renders the HistoryShell when allSkills is supplied", () => {
    const skill = makeSkill();
    const tree = expand(RightPanel({
      selectedSkillInfo: skill,
      activeDetailTab: "history",
      onDetailTabChange: () => {},
      allSkills: [skill],
      onSelectSkill: () => {},
    }));
    const histShell = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "history-shell";
    });
    expect(histShell.length).toBeGreaterThan(0);
    const fallbackTexts = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return typeof attrs.children === "string" && /select a skill/i.test(String(attrs.children));
    });
    expect(fallbackTexts.length).toBe(0);
  });
});
