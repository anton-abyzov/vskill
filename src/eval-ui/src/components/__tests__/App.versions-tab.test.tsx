// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-063: App-level Versions tab wiring
// ---------------------------------------------------------------------------
// The bug (qa-findings #1): App.tsx passed `selectedSkillInfo` to RightPanel
// without supplying an `onDetailTabChange` handler, so clicking "Versions"
// was a dead no-op. These tests lock down the contract: once App lifts the
// tab state, clicking a tab button must change the active tab, and the
// detail shell must render the matching tab panel.
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

// Stubs identical to detail-right-panel.test.tsx so RightPanel can be
// rendered in isolation without pulling workspace modules.
vi.mock("../../pages/workspace/SkillWorkspace", () => ({
  SkillWorkspaceInner: () => null,
}));
vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({
  VersionHistoryPanel: () =>
    ({ type: "div", props: { "data-testid": "version-history-panel", children: "Versions pane" } }) as unknown,
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

describe("T-063 RightPanel — Versions tab wiring", () => {
  it("Overview tab is the default when activeDetailTab is not supplied", () => {
    const skill = makeSkill();
    const tree = RightPanel({ selectedSkillInfo: skill });
    // Look for the overview tab's button aria-selected state.
    const tabs = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && typeof attrs["aria-selected"] === "boolean" && attrs.id === "detail-tab-overview";
    });
    expect(tabs.length).toBe(1);
    expect(tabs[0].props["aria-selected"]).toBe(true);
  });

  it("Versions tab becomes aria-selected when activeDetailTab='versions'", () => {
    const skill = makeSkill();
    const tree = RightPanel({ selectedSkillInfo: skill, activeDetailTab: "versions" });
    const versionsTab = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && attrs.id === "detail-tab-versions";
    })[0];
    expect(versionsTab).toBeTruthy();
    expect(versionsTab.props["aria-selected"]).toBe(true);
  });

  it("clicking the Versions tab button invokes onDetailTabChange with 'versions'", () => {
    const skill = makeSkill();
    const spy = vi.fn();
    const tree = RightPanel({
      selectedSkillInfo: skill,
      activeDetailTab: "overview",
      onDetailTabChange: spy,
    });
    const versionsTab = findElements(tree as unknown, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return el.type === "button" && attrs.id === "detail-tab-versions";
    })[0];
    expect(versionsTab).toBeTruthy();
    (versionsTab.props.onClick as () => void)();
    expect(spy).toHaveBeenCalledWith("versions");
  });

  it("Versions tab panel renders the VersionHistoryPanel (not the 'Select a skill' fallback) when allSkills is supplied", () => {
    const skill = makeSkill();
    const tree = expand(RightPanel({
      selectedSkillInfo: skill,
      activeDetailTab: "versions",
      onDetailTabChange: () => {},
      allSkills: [skill],
      onSelectSkill: () => {},
    }));
    // VersionHistoryPanel stub carries data-testid="version-history-panel".
    const histPanel = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "version-history-panel";
    });
    expect(histPanel.length).toBeGreaterThan(0);
    // And the 'Select a skill from the sidebar…' fallback must NOT be in the tree.
    const fallbackTexts = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return typeof attrs.children === "string" && /select a skill/i.test(String(attrs.children));
    });
    expect(fallbackTexts.length).toBe(0);
  });
});
