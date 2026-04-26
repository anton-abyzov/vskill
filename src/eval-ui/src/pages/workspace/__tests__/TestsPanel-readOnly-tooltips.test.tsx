// ---------------------------------------------------------------------------
// RED test: when isReadOnly is true, the disabled buttons in the empty-state
// of TestsPanel must expose a `title` attribute explaining why — so users
// understand it's not broken, just an installed (read-only) copy.
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
  plugin: "anton-abyzov",
  skill: "greet-anton",
  evals: null as unknown,
  evalsError: null,
  selectedCaseId: null as number | null,
  inlineResults: new Map(),
  caseRunStates: new Map(),
  generateEvalsLoading: false,
  generateEvalsProgress: [],
  generateEvalsError: null,
};

let mockIsReadOnly = true;

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
    get isReadOnly() {
      return mockIsReadOnly;
    },
  }),
}));

vi.mock("../../../../eval/verdict.js", () => ({ verdictExplanation: vi.fn() }));
vi.mock("../../components/ProgressLog", () => ({ ProgressLog: () => null }));
vi.mock("../../components/ErrorCard", () => ({ ErrorCard: () => null }));
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

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => collectElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...collectElements(el.props.children, match));
  return results;
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

describe("TestsPanel — read-only tooltips on disabled buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.evals = null;
    mockState.generateEvalsError = null;
    mockState.generateEvalsLoading = false;
  });

  it("when isReadOnly=true, 'Create Test Case' button has a title attribute mentioning installed/read-only", () => {
    mockIsReadOnly = true;
    const tree = TestsPanel();

    const createButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).trim() === "Create Test Case",
    );
    expect(createButtons.length).toBe(1);
    const title = createButtons[0].props.title as string | undefined;
    expect(title).toBeDefined();
    expect(title!.toLowerCase()).toMatch(/installed|read.?only/);
  });

  it("when isReadOnly=true, 'Generate Unit Tests' button has a title attribute mentioning installed/read-only", () => {
    mockIsReadOnly = true;
    const tree = TestsPanel();

    const genButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).includes("Generate Unit Tests"),
    );
    expect(genButtons.length).toBe(1);
    const title = genButtons[0].props.title as string | undefined;
    expect(title).toBeDefined();
    expect(title!.toLowerCase()).toMatch(/installed|read.?only/);
  });

  it("when isReadOnly=false, 'Generate Unit Tests' button has no read-only title", () => {
    mockIsReadOnly = false;
    const tree = TestsPanel();

    const genButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).includes("Generate Unit Tests"),
    );
    expect(genButtons.length).toBe(1);
    const title = (genButtons[0].props.title as string | undefined) ?? "";
    expect(title.toLowerCase()).not.toMatch(/installed|read.?only/);
  });

  it("when isReadOnly=false, 'Create Test Case' button has no read-only title", () => {
    mockIsReadOnly = false;
    const tree = TestsPanel();

    const createButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).trim() === "Create Test Case",
    );
    expect(createButtons.length).toBe(1);
    const title = (createButtons[0].props.title as string | undefined) ?? "";
    expect(title.toLowerCase()).not.toMatch(/installed|read.?only/);
  });
});
