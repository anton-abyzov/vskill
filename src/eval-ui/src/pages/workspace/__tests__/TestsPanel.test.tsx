// ---------------------------------------------------------------------------
// RED test: onRetry should not forward MouseEvent to handleGenerateEvals
// (US-002 / AC-US2-01 / 0569)
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
  generateEvalsProgress: [],
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

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
    Fragment: actual.Fragment,
  };
});

import { TestsPanel } from "../TestsPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/** Recursively find element nodes whose type is a function (component) with an onRetry prop */
function findElementsWithOnRetry(node: unknown): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(findElementsWithOnRetry);
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && typeof el.type === "function" && el.props?.onRetry != null) {
    results.push(el);
  }
  if (el.props?.children != null) results.push(...findElementsWithOnRetry(el.props.children));
  return results;
}

describe("TestsPanel — onRetry event leak fix (US-002 / AC-US2-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up state with a generateEvalsError so ErrorCard renders
    mockState.evals = { skill_name: "chrome-post-automator", evals: [] };
    mockState.generateEvalsError = {
      category: "model_not_found",
      title: "Model Not Found",
      description: "Model not available",
      hint: "Try a different model",
      retryable: true,
    };
  });

  it("calls handleGenerateEvals with NO arguments when retry is clicked", () => {
    // Render TestsPanel — empty-state branch includes ErrorCard when generateEvalsError is set
    const tree = TestsPanel();

    // Walk the JSX tree to find elements with an onRetry prop (ErrorCard)
    const elementsWithRetry = findElementsWithOnRetry(tree);
    expect(elementsWithRetry.length).toBeGreaterThan(0);

    const onRetry = elementsWithRetry[0].props.onRetry as Function;
    expect(onRetry).toBeDefined();

    // Simulate what React does when a button onClick fires:
    // The onRetry callback receives a MouseEvent from the button.
    // Node.js lacks MouseEvent, so use a plain object with event-like shape.
    const fakeMouseEvent = { type: "click", target: null, preventDefault: () => {} };
    onRetry(fakeMouseEvent);

    // handleGenerateEvals (returned by useCallback mock) calls generateEvals.
    // The current bug: onRetry={handleGenerateEvals} passes MouseEvent through.
    // The fix: onRetry={() => handleGenerateEvals()} wraps it, dropping the event.
    // Verify generateEvals was NOT called with the MouseEvent.
    expect(mockGenerateEvals).toHaveBeenCalledTimes(1);
    expect(mockGenerateEvals).toHaveBeenCalledWith(undefined);
  });
});
