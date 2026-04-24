import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock useWorkspace to control component state
// ---------------------------------------------------------------------------

const mockState = {
  plugin: "marketing",
  skill: "chrome-post-automator",
  activationPrompts: "",
  activationResults: [],
  activationSummary: null,
  activationRunning: false,
  activationError: null,
  activationStartedAt: null,
  generatingPrompts: false,
  generatingPromptsError: null,
  activationHistory: null,
};

const mockDispatch = vi.fn();
const mockRunActivationTest = vi.fn();
const mockCancelActivation = vi.fn();
const mockGenerateActivationPrompts = vi.fn();

vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: mockState,
    dispatch: mockDispatch,
    runActivationTest: mockRunActivationTest,
    cancelActivation: mockCancelActivation,
    generateActivationPrompts: mockGenerateActivationPrompts,
  }),
}));

// 0707 T-009: ActivationPanel now consults StudioContext to resolve the
// skill's frontmatter version for the activation-history row VersionBadge.
vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({
    state: {
      skills: [],
      selectedSkill: null,
      mode: "browse",
      searchQuery: "",
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

// Mock renderMarkdown (sanitization is handled by the real implementation)
vi.mock("../../../../utils/renderMarkdown", () => ({
  renderMarkdown: (s: string) => s,
}));

// Minimal React mock
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: (init: unknown) => [init, vi.fn()],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (init: unknown) => ({ current: init }),
  };
});

import { ActivationPanel } from "../ActivationPanel";

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

describe("ActivationPanel — disabled-reason hint (T-008 / 0566)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.activationRunning = false;
    mockState.activationError = null;
    mockState.generatingPromptsError = null;
  });

  it("renders hint text when no description available", () => {
    // skillDescription stays null (useEffect is mocked, fetch never runs)
    const el = ActivationPanel() as unknown as ReactEl;
    const text = flattenText(el);
    expect(text).toContain("Add a description to your skill's frontmatter to enable prompt generation.");
  });

  it("does not render hint when activationRunning is true", () => {
    mockState.activationRunning = true;
    const el = ActivationPanel() as unknown as ReactEl;
    const text = flattenText(el);
    expect(text).not.toContain("Add a description to your skill's frontmatter to enable prompt generation.");
  });
});
