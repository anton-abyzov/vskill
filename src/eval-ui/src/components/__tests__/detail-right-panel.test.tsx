// ---------------------------------------------------------------------------
// T-031: Wire MetadataTab + VersionHistoryPanel into RightPanel tab bar
// T-033: Detail panel empty and error states
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

// The heavy workspace panels are irrelevant for RightPanel shape tests;
// stub them so RightPanel can be imported without pulling the entire
// WorkspaceContext surface into this test file.
vi.mock("../../pages/workspace/SkillWorkspace", () => ({
  SkillWorkspaceInner: () => null,
}));
vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({
  VersionHistoryPanel: () => null,
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

// Stub eval-ui StudioContext so RightPanel's default branch is a no-op
// when tests don't exercise the integrated path.
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

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "p",
    skill: "s",
    dir: "/tmp/s",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 1,
    assertionCount: 1,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01",
    origin: "source",
    description: "d",
    version: "1.0.0",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20",
    sizeBytes: 100,
    sourceAgent: null,
    ...over,
  };
}

// T-033 EMPTY STATE
describe("T-033 RightPanel — empty and error states", () => {
  it("renders the no-selection empty state calmly when no skill selected", () => {
    const tree = RightPanel({ selectedSkillInfo: null });
    const text = collectText(tree);
    expect(text).toContain("Select a skill to view details");
  });

  it("renders a friendly error state when skill load fails (no 'Oops')", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill(),
      loadError: "permission denied",
    });
    const text = collectText(tree);
    // Error copy per spec: "Couldn't load SKILL.md for <skill>"
    expect(text).toContain("Couldn't load");
    expect(text.toLowerCase()).not.toContain("oops");
  });
});

// T-031 TAB BAR + INTEGRATION
// History: 0707 T-007 expanded to 9 flat tabs. 0769 T-019 collapsed to 6
// author / 3 consumer. 0792 T-013 collapsed to 4. 0805 restored Tests as
// a top-level tab → 5-tab author IA (Overview / Edit / Tests / Run / History)
// and 4 for consumers (Overview / Tests / Run / History).
describe("T-031 RightPanel — persona-conditional tab bar (5 author / 4 consumer)", () => {
  it("renders the DetailHeader and every author tab label when a source skill is selected", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill() });
    const text = collectText(tree);
    for (const label of [
      "Overview",
      "Edit",
      "Tests",
      "Run",
      "History",
    ]) {
      expect(text).toContain(label);
    }
  });

  it("active tab uses 2px underline via border-bottom (no pill fill)", () => {
    const tree = RightPanel({ selectedSkillInfo: makeSkill(), activeDetailTab: "overview" });
    const tabs = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["role"] === "tab";
    });
    // 0823: Source tab added → 6 tabs for source-origin skills.
    expect(tabs.length).toBe(6);
    const activeTab = tabs.find((t) => t.props["aria-selected"] === true);
    expect(activeTab).toBeTruthy();
    const style = activeTab!.props.style as Record<string, string>;
    expect(style.borderBottom).toContain("2px");
  });

  it("renders the SkillOverview (metric grid) when activeDetailTab is overview", () => {
    const tree = RightPanel({
      selectedSkillInfo: makeSkill({ version: "1.2.3" }),
      activeDetailTab: "overview",
    });
    // The Overview body is a <SkillOverview> element — findAll matches by
    // component function-type name since findAll here does not recurse into
    // function components.
    const overview = findAll(tree, (el) => {
      if (typeof el.type !== "function") return false;
      const name = (el.type as { name?: string }).name ?? "";
      return name === "SkillOverview";
    });
    expect(overview.length).toBeGreaterThanOrEqual(1);
  });
});
