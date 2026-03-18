// ---------------------------------------------------------------------------
// RED tests: Tab filter → selectedCaseId sync (US-001 / 0563)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSaveEvals = vi.fn();
const mockRunCase = vi.fn();
const mockRunAll = vi.fn();
const mockCancelCase = vi.fn();
const mockCancelAll = vi.fn();
const mockGenerateEvals = vi.fn();

const mockState: Record<string, unknown> = {
  plugin: "marketing",
  skill: "chrome-post-automator",
  evals: null as unknown,
  evalsError: null,
  selectedCaseId: null as number | null,
  inlineResults: new Map(),
  caseRunStates: new Map(),
  generateEvalsLoading: false,
  generateEvalsProgress: null,
  generateEvalsError: null,
};

vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: mockDispatch,
    saveEvals: mockSaveEvals,
    runCase: mockRunCase,
    runAll: mockRunAll,
    cancelCase: mockCancelCase,
    cancelAll: mockCancelAll,
    generateEvals: mockGenerateEvals,
    isReadOnly: false,
  }),
}));

vi.mock("../../../../eval/verdict.js", () => ({
  verdictExplanation: vi.fn(),
}));

vi.mock("../../components/ProgressLog", () => ({
  ProgressLog: () => null,
}));

vi.mock("../../components/ErrorCard", () => ({
  ErrorCard: () => null,
}));

vi.mock("../../utils/historyUtils", () => ({
  passRateColor: () => "green",
  shortDate: () => "today",
  fmtDuration: () => "1s",
  MiniTrend: () => null,
}));

vi.mock("../../api", () => ({
  api: {
    getCredentials: vi.fn().mockResolvedValue({ credentials: [] }),
    getCaseHistory: vi.fn().mockResolvedValue([]),
  },
}));

// Track which value useState returns for testTypeFilter
let useStateCalls = 0;
let testTypeFilterValue: "all" | "unit" | "integration" = "all";
const setTestTypeFilter = vi.fn();

// Track useEffect callbacks so we can invoke them
const useEffectCallbacks: Array<() => void | (() => void)> = [];

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => {
      useStateCalls++;
      // The 3rd useState call is testTypeFilter (after isAnyRunning check, showForm)
      if (useStateCalls === 2) {
        return [testTypeFilterValue, setTestTypeFilter];
      }
      return [init, vi.fn()];
    },
    useEffect: (cb: () => void | (() => void)) => {
      useEffectCallbacks.push(cb);
    },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
    Fragment: actual.Fragment,
  };
});

import { TestsPanel } from "../TestsPanel";

type ReactEl = { type: string | Function; props: Record<string, unknown>; children?: unknown[] };

function flattenText(el: unknown): string {
  if (el == null || typeof el === "boolean") return "";
  if (typeof el === "string") return el;
  if (typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(flattenText).join("");
  if (typeof el === "object" && el !== null) {
    const e = el as ReactEl;
    const childText = e.props?.children != null ? flattenText(e.props.children) : "";
    return childText;
  }
  return "";
}

describe("TestsPanel — tab filter selectedCaseId sync (US-001 / 0563)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStateCalls = 0;
    testTypeFilterValue = "all";
    useEffectCallbacks.length = 0;

    // Default: has unit and integration tests
    mockState.evals = {
      skill_name: "chrome-post-automator",
      evals: [
        { id: 1, name: "unit-test-1", prompt: "test", expected_output: "out", files: [], assertions: [{ id: "1_1", text: "works", type: "boolean" }] },
        { id: 2, name: "unit-test-2", prompt: "test", expected_output: "out", files: [], assertions: [{ id: "2_1", text: "works", type: "boolean" }] },
        { id: 3, name: "int-test-1", prompt: "test", expected_output: "out", files: [], assertions: [{ id: "3_1", text: "works", type: "boolean" }], testType: "integration" },
      ],
    };
    mockState.selectedCaseId = 1;
    mockState.evalsError = null;
  });

  it("AC-US1-01: switching to integration tab with unit case selected dispatches SELECT_CASE to first integration case", () => {
    // Simulate filter set to "integration" while case 1 (unit) is selected
    testTypeFilterValue = "integration";

    const el = TestsPanel() as unknown as ReactEl;

    // The useEffect that syncs selectedCaseId should have been registered
    // and when invoked, should dispatch SELECT_CASE with the first integration case (id: 3)
    expect(useEffectCallbacks.length).toBeGreaterThan(0);

    // Invoke all registered effects
    for (const cb of useEffectCallbacks) cb();

    // Should dispatch to select the first integration case
    expect(mockDispatch).toHaveBeenCalledWith({ type: "SELECT_CASE", caseId: 3 });
  });

  it("AC-US1-01: inline 'No integration tests' shown when filter has no matches", () => {
    // Only unit tests, filter to integration
    mockState.evals = {
      skill_name: "chrome-post-automator",
      evals: [
        { id: 1, name: "unit-test-1", prompt: "test", expected_output: "out", files: [], assertions: [{ id: "1_1", text: "works", type: "boolean" }] },
      ],
    };
    testTypeFilterValue = "integration";

    const el = TestsPanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("No integration tests yet");
  });

  it("AC-US1-02: after seeing 'No integration tests', switching to All shows all tests", () => {
    testTypeFilterValue = "all";

    const el = TestsPanel() as unknown as ReactEl;
    const text = flattenText(el);

    // Should show test case names, not "No tests" message
    expect(text).toContain("unit-test-1");
    expect(text).toContain("int-test-1");
    expect(text).not.toContain("No ");
  });

  it("AC-US1-02: dispatches SELECT_CASE with null when filter has zero matching cases", () => {
    // Only unit tests, filter to integration — no matches
    mockState.evals = {
      skill_name: "chrome-post-automator",
      evals: [
        { id: 1, name: "unit-test-1", prompt: "test", expected_output: "out", files: [], assertions: [{ id: "1_1", text: "works", type: "boolean" }] },
      ],
    };
    mockState.selectedCaseId = 1;
    testTypeFilterValue = "integration";

    TestsPanel();

    // Invoke all registered effects
    for (const cb of useEffectCallbacks) cb();

    // Should dispatch null since no integration cases exist
    expect(mockDispatch).toHaveBeenCalledWith({ type: "SELECT_CASE", caseId: null });
  });

  it("AC-US1-03: full empty state shown when allCases.length === 0", () => {
    mockState.evals = { skill_name: "chrome-post-automator", evals: [] };
    mockState.selectedCaseId = null;
    testTypeFilterValue = "all";

    const el = TestsPanel() as unknown as ReactEl;
    const text = flattenText(el);

    // Should show the full empty state, not just inline message
    expect(text).toContain("No test cases yet");
  });

  it("AC-US1-04: shows validation error when evals is null", () => {
    mockState.evals = null;
    mockState.evalsError = "JSON parse error: unexpected token";
    mockState.selectedCaseId = null;

    const el = TestsPanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("JSON parse error");
  });
});
