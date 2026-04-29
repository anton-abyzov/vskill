// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0800 [RED] — RunDispatcherPanel autorun on `?autorun=1`.
//
// US-001 / AC-US1-04:
//   - URL has ?autorun=1 + cases.length > 0
//     → runAll("benchmark") called exactly once
//     → autorun param stripped from URL post-dispatch
//   - URL has no autorun param → runAll NOT called
//   - StrictMode-style double-mount → still exactly once
//   - cases.length === 0 → runAll NOT called
//
// We render RunDispatcherPanel in jsdom and rely on React's actual mounting
// because the autorun behaviour is a useEffect side-effect.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const mockRunAll = vi.fn();

let mockEvalsCases: Array<{ id: number }> = [];

vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  useWorkspace: () => ({
    state: {
      plugin: "anton-abyzov",
      skill: "greet-anton",
      evals: { skill_name: "greet-anton", evals: mockEvalsCases },
      caseRunStates: new Map(),
      latestBenchmark: null,
      activationHistory: null,
      activationHistoryLoading: false,
      activationPrompts: "",
      activationResults: [],
      activationSummary: null,
      activationRunning: false,
      activationError: null,
      activationTotalPrompts: 0,
      activationStartedAt: null,
      activationClassifyingStatus: null,
      activationPromptsSource: null,
      activationPromptsCanonical: "",
      generatingPrompts: false,
      generatingPromptsError: null,
      savingTestCases: false,
      savingTestCasesError: null,
      savingTestCasesSuccess: null,
    },
    dispatch: vi.fn(),
    isReadOnly: false,
    canEdit: true,
    canRun: mockEvalsCases.length > 0,
    runAll: mockRunAll,
    runCase: vi.fn(),
    cancelCase: vi.fn(),
    cancelAll: vi.fn(),
    saveContent: vi.fn(),
    saveEvals: vi.fn(),
    generateEvals: vi.fn(),
    runActivationTest: vi.fn(),
    cancelActivation: vi.fn(),
    generateActivationPrompts: vi.fn(),
    fetchActivationHistory: vi.fn(),
    loadTestCasesFromSkillMd: vi.fn(),
    saveTestCasesToSkillMd: vi.fn(),
    submitAiEdit: vi.fn(),
    cancelAiEdit: vi.fn(),
    applyAiEdit: vi.fn(),
    discardAiEdit: vi.fn(),
    toggleEvalChange: vi.fn(),
    selectAllEvalChanges: vi.fn(),
    deselectAllEvalChanges: vi.fn(),
    retryEvalsSave: vi.fn(),
    improveForCase: vi.fn(),
    applyImproveAndRerun: vi.fn(),
    refreshSkillContent: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: unknown }) => children,
}));

// Stub heavy children so the autorun effect can run in isolation.
vi.mock("../../pages/workspace/RunPanel", () => ({
  RunPanel: () => null,
}));
vi.mock("../../pages/workspace/ActivationPanel", () => ({
  ActivationPanel: () => null,
}));

import { RunDispatcherPanel } from "../../pages/workspace/RunDispatcherPanel";
import * as React from "react";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function setSearch(qs: string) {
  window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
}

describe("RunDispatcherPanel — autorun (?autorun=1)", () => {
  beforeEach(() => {
    // Tell React this is an act() environment so the act warnings don't fire.
    // Without this, importing `act` from "react" in jsdom emits warnings on
    // every effect that masks future regressions.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockRunAll.mockReset();
    mockEvalsCases = [{ id: 1 }, { id: 2 }];
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    setSearch("");
  });

  it("AC-US1-04: ?autorun=1 + cases > 0 → runAll('benchmark') called once and param stripped", () => {
    setSearch("?tab=run&mode=benchmark&autorun=1");
    root = createRoot(container!);
    act(() => {
      root!.render(React.createElement(RunDispatcherPanel, { mode: "benchmark" }));
    });

    expect(mockRunAll).toHaveBeenCalledTimes(1);
    expect(mockRunAll).toHaveBeenCalledWith("benchmark");

    // autorun param stripped after dispatch
    const params = new URLSearchParams(window.location.search);
    expect(params.get("autorun")).toBeNull();
    // tab/mode preserved
    expect(params.get("tab")).toBe("run");
    expect(params.get("mode")).toBe("benchmark");
  });

  it("URL has no autorun param → runAll NOT called", () => {
    setSearch("?tab=run&mode=benchmark");
    root = createRoot(container!);
    act(() => {
      root!.render(React.createElement(RunDispatcherPanel, { mode: "benchmark" }));
    });

    expect(mockRunAll).not.toHaveBeenCalled();
  });

  it("StrictMode-style double mount → runAll still called only once", () => {
    setSearch("?tab=run&mode=benchmark&autorun=1");
    root = createRoot(container!);
    act(() => {
      root!.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(RunDispatcherPanel, { mode: "benchmark" }),
        ),
      );
    });
    expect(mockRunAll).toHaveBeenCalledTimes(1);
  });

  it("?autorun=1 with zero cases → runAll NOT called and param NOT stripped (still pending)", () => {
    mockEvalsCases = [];
    setSearch("?tab=run&mode=benchmark&autorun=1");
    root = createRoot(container!);
    act(() => {
      root!.render(React.createElement(RunDispatcherPanel, { mode: "benchmark" }));
    });

    expect(mockRunAll).not.toHaveBeenCalled();
  });

  it("activation mode → autorun does NOT trigger benchmark", () => {
    setSearch("?tab=run&mode=activation&autorun=1");
    root = createRoot(container!);
    act(() => {
      root!.render(React.createElement(RunDispatcherPanel, { mode: "activation" }));
    });
    expect(mockRunAll).not.toHaveBeenCalled();
  });
});
