// ---------------------------------------------------------------------------
// Tests: ParameterStorePanel credential/param management (US-002 / 0563)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockState = {
  plugin: "marketing",
  skill: "chrome-post-automator",
  evals: {
    skill_name: "chrome-post-automator",
    evals: [
      {
        id: 1, name: "post-to-linkedin", prompt: "post", expected_output: "posted",
        files: [], assertions: [{ id: "1_1", text: "works", type: "boolean" }],
        testType: "integration" as const,
        requiredCredentials: ["LINKEDIN_ACCESS_TOKEN", "GITHUB_TOKEN"],
      },
    ],
  },
};

vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: vi.fn(),
  }),
}));

const mockGetCredentials = vi.fn();
const mockGetParams = vi.fn();
const mockGetParamsRevealed = vi.fn();
const mockSetCredential = vi.fn();

vi.mock("../../api", () => ({
  api: {
    getCredentials: (...args: unknown[]) => mockGetCredentials(...args),
    getParams: (...args: unknown[]) => mockGetParams(...args),
    getParamsRevealed: (...args: unknown[]) => mockGetParamsRevealed(...args),
    setCredential: (...args: unknown[]) => mockSetCredential(...args),
  },
}));

// ---------------------------------------------------------------------------
// Pre-populated useState values
// ParameterStorePanel useState order:
// 0: credentials, 1: params, 2: loading, 3: error,
// 4: revealed, 5: editingKey, 6: editValue, 7: saving,
// 8: newKey, 9: newValue
// ---------------------------------------------------------------------------

let useStateIndex = 0;
const stateOverrides: Record<number, unknown> = {};

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = useStateIndex++;
      const value = idx in stateOverrides ? stateOverrides[idx] : init;
      return [value, vi.fn()];
    },
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
  };
});

import { ParameterStorePanel } from "../ParameterStorePanel";

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

describe("ParameterStorePanel (US-002 / 0563)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStateIndex = 0;
    // Clear all overrides
    for (const k of Object.keys(stateOverrides)) delete stateOverrides[Number(k)];

    // Pre-populate loaded state
    stateOverrides[0] = [ // credentials
      { name: "LINKEDIN_ACCESS_TOKEN", status: "ready", source: "dotenv" },
      { name: "GITHUB_TOKEN", status: "missing" },
    ];
    stateOverrides[1] = [ // params
      { name: "LINKEDIN_ACCESS_TOKEN", maskedValue: "***oken", status: "ready" },
    ];
    stateOverrides[2] = false; // loading = false (loaded)
    stateOverrides[3] = null;  // error = null
  });

  it("AC-US2-01: renders credential list with ready/missing status badges", () => {
    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("LINKEDIN_ACCESS_TOKEN");
    expect(text).toContain("GITHUB_TOKEN");
    expect(text).toContain("ready");
    expect(text).toContain("missing");
  });

  it("AC-US2-02: ready credentials show masked value with show/hide toggle", () => {
    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("***");
    expect(text).toMatch(/show/i);
  });

  it("AC-US2-03: edit button available for each credential", () => {
    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    // Should have Edit buttons
    expect(text).toMatch(/edit/i);
  });

  it("AC-US2-05: has add parameter section", () => {
    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("Add New Parameter");
    expect(text).toContain("Add");
  });

  it("shows loading state when data is being fetched", () => {
    stateOverrides[0] = []; // no credentials yet
    stateOverrides[1] = []; // no params yet
    stateOverrides[2] = true; // loading = true

    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("Loading...");
    expect(text).not.toContain("No parameters configured");
  });

  it("shows error banner when fetch fails", () => {
    stateOverrides[0] = [];
    stateOverrides[1] = [];
    stateOverrides[2] = false; // loading done
    stateOverrides[3] = "Network error: connection refused"; // error

    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("Network error: connection refused");
  });

  it("shows empty state only after loading completes with no data", () => {
    stateOverrides[0] = [];
    stateOverrides[1] = [];
    stateOverrides[2] = false; // loading done
    stateOverrides[3] = null;  // no error

    const el = ParameterStorePanel() as unknown as ReactEl;
    const text = flattenText(el);

    expect(text).toContain("No parameters configured");
  });
});
