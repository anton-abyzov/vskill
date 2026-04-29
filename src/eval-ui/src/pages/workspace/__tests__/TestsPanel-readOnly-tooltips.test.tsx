// ---------------------------------------------------------------------------
// Originally a RED test for tooltip-on-disabled pattern. After 0800 the
// design changed: authoring buttons (Create / Generate / Add) are HIDDEN for
// installed skills (`canEdit=false`) rather than rendered-but-disabled.
// Run buttons stay visible and gated on `canRun` instead.
//
// These tests now verify the new contract:
//   - canEdit=false → Create / Generate buttons not in tree
//   - canEdit=true  → Create / Generate buttons present without read-only
//                     tooltips (no degraded affordances on the source path)
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

let mockOrigin: "source" | "installed" = "installed";

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
      return mockOrigin === "installed";
    },
    get canEdit() {
      return mockOrigin === "source";
    },
    get canRun() {
      return false;
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

describe("TestsPanel — authoring buttons gated on canEdit (post-0800)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.evals = null;
    mockState.generateEvalsError = null;
    mockState.generateEvalsLoading = false;
  });

  it("when canEdit=false (installed), 'Create Test Case' button is NOT rendered", () => {
    mockOrigin = "installed";
    const tree = TestsPanel();
    const createButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).trim() === "Create Test Case",
    );
    expect(createButtons).toHaveLength(0);
  });

  it("when canEdit=false (installed), 'Generate Unit Tests' button is NOT rendered", () => {
    mockOrigin = "installed";
    const tree = TestsPanel();
    const genButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).includes("Generate Unit Tests"),
    );
    expect(genButtons).toHaveLength(0);
  });

  it("when canEdit=true (source), 'Generate Unit Tests' button is rendered without read-only title", () => {
    mockOrigin = "source";
    const tree = TestsPanel();
    const genButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).includes("Generate Unit Tests"),
    );
    expect(genButtons.length).toBe(1);
    const title = (genButtons[0].props.title as string | undefined) ?? "";
    expect(title.toLowerCase()).not.toMatch(/installed|read.?only/);
  });

  it("when canEdit=true (source), 'Create Test Case' button is rendered without read-only title", () => {
    mockOrigin = "source";
    const tree = TestsPanel();
    const createButtons = collectElements(tree, (el) =>
      el.type === "button" && collectText(el).trim() === "Create Test Case",
    );
    expect(createButtons.length).toBe(1);
    const title = (createButtons[0].props.title as string | undefined) ?? "";
    expect(title.toLowerCase()).not.toMatch(/installed|read.?only/);
  });
});
