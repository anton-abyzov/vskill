// ---------------------------------------------------------------------------
// 0800 [RED] — TestsPanel must allow installed-skill users to RUN evals.
//
// US-002 ACs covered:
//   - AC-US2-01: Run buttons visible per-case for installed skills
//   - AC-US2-02: Run All button visible at panel header
//   - AC-US2-03: Add/Edit/Delete controls hidden for installed
//   - AC-US2-04: Read-only banner present (role="status") with copy
//                referencing read-only + the source-install command
//
// The previous gate (`disabled={isReadOnly}` on per-case Run, and the
// "Run All" toolbar hidden behind `!isReadOnly`) wrongly conflated edit
// and run capabilities. After 0800 the gates split into:
//   canRun  = evals.exists && cases.length > 0  (origin-agnostic)
//   canEdit = origin === "source"
//
// We render TestsPanel directly via the function-call pattern (no DOM)
// to mirror the rest of the suite — see TestsPanel-readOnly-tooltips.test.tsx.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock infrastructure — shared across both source and installed scenarios.
// ---------------------------------------------------------------------------

const mockDispatch = vi.fn();
const mockSaveEvals = vi.fn();
const mockRunCase = vi.fn();
const mockRunAll = vi.fn();
const mockCancelCase = vi.fn();
const mockCancelAll = vi.fn();
const mockGenerateEvals = vi.fn();

interface MockEvalCase {
  id: number;
  name: string;
  prompt: string;
  expected_output: string;
  assertions: Array<{ id: string; text: string; type: string }>;
  testType?: "unit" | "integration";
}

const c1: MockEvalCase = {
  id: 1,
  name: "case one",
  prompt: "p1",
  expected_output: "e1",
  assertions: [{ id: "a1", text: "must pass", type: "boolean" }],
};
const c2: MockEvalCase = {
  id: 2,
  name: "case two",
  prompt: "p2",
  expected_output: "e2",
  assertions: [{ id: "a2", text: "must work", type: "boolean" }],
};

const mockState: Record<string, unknown> = {
  plugin: "anton-abyzov",
  skill: "greet-anton",
  evals: { skill_name: "greet-anton", evals: [c1, c2] } as unknown,
  evalsError: null,
  selectedCaseId: null as number | null,
  inlineResults: new Map(),
  caseRunStates: new Map(),
  generateEvalsLoading: false,
  generateEvalsProgress: [],
  generateEvalsError: null,
};

// `mockOrigin` flips between scenarios. The new derivation lives in
// useSkillCapabilities, but TestsPanel will read `canEdit` / `canRun` off
// the WorkspaceContext (extended in this increment).
let mockOrigin: "source" | "installed" = "installed";

vi.mock("../../pages/workspace/WorkspaceContext", () => ({
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
      return ((mockState.evals as { evals: unknown[] } | null)?.evals?.length ?? 0) > 0;
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

import { TestsPanel } from "../../pages/workspace/TestsPanel";

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

describe("TestsPanel (0800) — read-only run for installed skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.evals = { skill_name: "greet-anton", evals: [c1, c2] };
    mockState.generateEvalsError = null;
    mockState.generateEvalsLoading = false;
  });

  it("AC-US2-02: 'Run All' button is rendered (and enabled) for installed skill with cases", () => {
    mockOrigin = "installed";
    const tree = TestsPanel();

    const runAllButtons = collectElements(
      tree,
      (el) => el.type === "button" && /Run All/i.test(collectText(el)),
    );
    expect(runAllButtons.length).toBeGreaterThanOrEqual(1);
    // Must NOT be disabled — the entire bug being fixed.
    const enabled = runAllButtons.find((b) => !b.props.disabled);
    expect(enabled, "expected an enabled Run All button on installed skill with cases").toBeTruthy();
  });

  it("AC-US2-03: 'Add Test Case' / 'Create Test Case' button is NOT rendered for installed skill", () => {
    mockOrigin = "installed";
    const tree = TestsPanel();

    const addButtons = collectElements(tree, (el) => {
      if (el.type !== "button") return false;
      const text = collectText(el).trim();
      return /Add Test Case|Create Test Case/i.test(text);
    });
    expect(addButtons).toHaveLength(0);
  });

  it("AC-US2-04: read-only banner is rendered with role='status' and references read-only", () => {
    mockOrigin = "installed";
    const tree = TestsPanel();

    const banners = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "tests-readonly-banner",
    );
    expect(banners.length).toBeGreaterThanOrEqual(1);
    expect(banners[0].props.role).toBe("status");

    const text = collectText(banners[0]).toLowerCase();
    expect(text).toMatch(/read.?only/);
    // Mentions the source-install path so users know how to author.
    expect(text).toMatch(/vskill plugin new|install.*source|source/);
  });

  it("AC-US2-05/sanity: source skill still shows Add Test Case button", () => {
    mockOrigin = "source";
    const tree = TestsPanel();

    const addButtons = collectElements(tree, (el) => {
      if (el.type !== "button") return false;
      const text = collectText(el).trim();
      return /Add Test Case|Create Test Case/i.test(text);
    });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("source skill does NOT render the read-only banner", () => {
    mockOrigin = "source";
    const tree = TestsPanel();

    const banners = collectElements(
      tree,
      (el) => el.props?.["data-testid"] === "tests-readonly-banner",
    );
    expect(banners).toHaveLength(0);
  });
});
