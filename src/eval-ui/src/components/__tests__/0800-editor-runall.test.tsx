// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0800 [RED] — EditorPanel "Run all" CTA in eval-cases section.
//
// US-001 ACs covered:
//   - AC-US1-02: Run all button visible when canEdit && cases.length > 0
//   - AC-US1-03: clicking sets URL to ?tab=run&mode=benchmark&autorun=1
//   - AC-US1-05: zero-cases state hides the button
//   - AC-US2-06: installed-skill Edit-tab continues to omit the CTA
//
// Strategy: import the exported `EvalCasesSection` helper and call it as a
// function so the JSX tree is materialised without a real DOM. This mirrors
// the rest of the suite (see RightPanel.flatTabs.test.tsx, App.versions-tab).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockOrigin: "source" | "installed" = "source";
let mockCases: Array<{ id: number; name: string; prompt: string; expected_output: string; assertions: unknown[] }> = [
  { id: 1, name: "case one", prompt: "p", expected_output: "e", assertions: [] },
];

const mockState: Record<string, unknown> = {
  plugin: "anton-abyzov",
  skill: "greet-anton",
  evals: { skill_name: "greet-anton", evals: [] as unknown[] },
  evalsError: null,
  selectedCaseId: null,
  inlineResults: new Map(),
  caseRunStates: new Map(),
  generateEvalsLoading: false,
  generateEvalsProgress: [],
  generateEvalsError: null,
};

vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: vi.fn(),
    saveEvals: vi.fn(),
    runCase: vi.fn(),
    runAll: vi.fn(),
    cancelCase: vi.fn(),
    cancelAll: vi.fn(),
    generateEvals: vi.fn(),
    get isReadOnly() {
      return mockOrigin === "installed";
    },
    get canEdit() {
      return mockOrigin === "source";
    },
    get canRun() {
      return mockCases.length > 0;
    },
  }),
}));

// Avoid heavy imports — TestsPanel's content isn't what's being tested.
vi.mock("../../pages/workspace/TestsPanel", () => ({
  TestsPanel: () => null,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, vi.fn()],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
    Fragment: actual.Fragment,
  };
});

import { EvalCasesSection } from "../../pages/workspace/EditorPanel";

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

describe("EditorPanel — eval-cases 'Run all' CTA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.evals = { skill_name: "greet-anton", evals: mockCases };
  });

  it("AC-US1-02: source skill with cases → 'Run all' button rendered with testid", () => {
    mockOrigin = "source";
    mockCases = [{ id: 1, name: "case", prompt: "p", expected_output: "e", assertions: [] }];
    mockState.evals = { skill_name: "greet-anton", evals: mockCases };

    const tree = EvalCasesSection();
    const buttons = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "editor-eval-cases-run-all",
    );
    expect(buttons.length).toBe(1);
  });

  it("AC-US1-03: clicking 'Run all' navigates to ?tab=run&mode=benchmark&autorun=1", () => {
    mockOrigin = "source";
    mockCases = [{ id: 1, name: "case", prompt: "p", expected_output: "e", assertions: [] }];
    mockState.evals = { skill_name: "greet-anton", evals: mockCases };

    const replaceSpy = vi.fn();
    const originalLocation = window.location;
    // jsdom present — build a fake history.replaceState we can verify
    Object.defineProperty(window.history, "replaceState", { value: replaceSpy, writable: true, configurable: true });
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, search: "", pathname: "/", hash: "" },
      writable: true,
      configurable: true,
    });

    const tree = EvalCasesSection();
    const buttons = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "editor-eval-cases-run-all",
    );
    expect(buttons.length).toBe(1);
    const onClick = buttons[0].props.onClick as (e: { preventDefault?: () => void }) => void;
    onClick({ preventDefault: () => {} });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    const targetUrl = String(replaceSpy.mock.calls[0][2]);
    expect(targetUrl).toMatch(/tab=run/);
    expect(targetUrl).toMatch(/mode=benchmark/);
    expect(targetUrl).toMatch(/autorun=1/);
  });

  it("AC-US1-05: source skill with zero cases → 'Run all' NOT rendered", () => {
    mockOrigin = "source";
    mockCases = [];
    mockState.evals = { skill_name: "greet-anton", evals: mockCases };

    const tree = EvalCasesSection();
    const buttons = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "editor-eval-cases-run-all",
    );
    expect(buttons).toHaveLength(0);
  });

  it("AC-US2-06: installed skill (canEdit=false) hides 'Run all' on Edit tab", () => {
    mockOrigin = "installed";
    mockCases = [{ id: 1, name: "case", prompt: "p", expected_output: "e", assertions: [] }];
    mockState.evals = { skill_name: "greet-anton", evals: mockCases };

    const tree = EvalCasesSection();
    const buttons = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "editor-eval-cases-run-all",
    );
    expect(buttons).toHaveLength(0);
  });
});
