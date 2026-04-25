// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0729 — VersionHistoryPanel empty-state guidance
//
// Locks the contract that an empty Versions tab renders one of two distinct
// empty states based on `skill.origin`:
//   - `"source"` (local-authored): explanatory text + "Submit on
//     verified-skill.com" CTA wired to buildSubmitUrl(homepage)
//   - else (installed): legacy "No version history available" line, no CTA
//
// We render the panel via react-test-renderer-style tree walking (matches the
// pattern in App.versions-tab.test.tsx) so we can assert on data-testid
// presence without spinning up a full DOM.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { SkillInfo } from "../../../types";

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

// Stub the SWR hook — we want full control over the loading / data shape.
let swrReturn: { data: unknown; loading: boolean } = { data: [], loading: false };
vi.mock("../../../hooks/useSWR", () => ({
  useSWR: () => swrReturn,
  mutate: vi.fn(),
}));

// Stub the API surface — VersionHistoryPanel imports `api` for getSkillVersions
// and api.startSkillUpdate; we never call them in these empty-state tests.
vi.mock("../../../api", () => ({
  api: {
    getSkillVersions: vi.fn(async () => []),
    getVersionDiff: vi.fn(),
    startSkillUpdate: vi.fn(),
  },
}));

// Workspace context: drive plugin + skill from per-test setup.
let workspaceState: { plugin: string; skill: string } = { plugin: "vskill", skill: "greet-anton" };
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({ state: workspaceState }),
}));

// Studio context: drive the skill array per-test so the panel can resolve
// origin + homepage.
let studioSkills: SkillInfo[] = [];
vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({
    state: { skills: studioSkills },
    refreshSkills: vi.fn(),
    updateCount: 0,
  }),
}));

// Mock ChangelogViewer — we never reach it in empty-state branches.
vi.mock("../../../components/ChangelogViewer", () => ({
  ChangelogViewer: () => null,
}));

import { VersionHistoryPanel } from "../VersionHistoryPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

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
    plugin: "vskill",
    skill: "greet-anton",
    dir: "/repo/skills/greet-anton",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "pending",
    lastBenchmark: null,
    origin: "source",
    description: null,
    version: "1.0.1",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: null,
    sizeBytes: null,
    sourceAgent: null,
    ...over,
  };
}

function findByTestId(tree: unknown, id: string): ReactEl[] {
  return findElements(tree, (el) => {
    const p = el.props as Record<string, unknown>;
    return p["data-testid"] === id;
  });
}

describe("0729 — VersionHistoryPanel empty-state", () => {
  it("AC-US1-01: source skill + empty versions → renders the LOCAL empty state with CTA", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "vskill", skill: "greet-anton" };
    studioSkills = [makeSkill({ origin: "source" })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    expect(findByTestId(tree, "versions-empty-state-local").length).toBe(1);
    expect(findByTestId(tree, "versions-empty-state-cta").length).toBe(1);
    expect(findByTestId(tree, "versions-empty-state-installed").length).toBe(0);
  });

  it("AC-US1-02: installed skill + empty versions → renders the INSTALLED empty state with no CTA", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "anthropic-skills", skill: "pdf" };
    studioSkills = [makeSkill({ plugin: "anthropic-skills", skill: "pdf", origin: "installed" })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    expect(findByTestId(tree, "versions-empty-state-installed").length).toBe(1);
    expect(findByTestId(tree, "versions-empty-state-cta").length).toBe(0);
    expect(findByTestId(tree, "versions-empty-state-local").length).toBe(0);
  });

  it("AC-US1-03: CTA href reflects the skill's homepage URL (encoded), with target=_blank + rel=noopener", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "vskill", skill: "greet-anton" };
    studioSkills = [makeSkill({
      origin: "source",
      homepage: "https://github.com/anton-abyzov/vskill",
    })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const ctas = findByTestId(tree, "versions-empty-state-cta");
    expect(ctas.length).toBe(1);
    const props = ctas[0].props as Record<string, unknown>;
    expect(typeof props.href).toBe("string");
    expect(props.href as string).toContain(
      "verified-skill.com/submit?repo=https%3A%2F%2Fgithub.com%2Fanton-abyzov%2Fvskill",
    );
    expect(props.target).toBe("_blank");
    expect(props.rel).toBe("noopener noreferrer");
  });

  it("AC-US1-03: CTA href falls back to the bare /submit URL when the skill has no homepage", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "vskill", skill: "greet-anton" };
    studioSkills = [makeSkill({ origin: "source", homepage: null })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const ctas = findByTestId(tree, "versions-empty-state-cta");
    expect(ctas.length).toBe(1);
    expect(ctas[0].props.href).toBe("https://verified-skill.com/submit");
  });

  it("AC-US1-04: defensive — when the skill is not yet present in studio.state.skills, falls back to installed legacy state", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "vskill", skill: "greet-anton" };
    studioSkills = []; // not yet loaded

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    expect(findByTestId(tree, "versions-empty-state-installed").length).toBe(1);
    expect(findByTestId(tree, "versions-empty-state-local").length).toBe(0);
  });
});
