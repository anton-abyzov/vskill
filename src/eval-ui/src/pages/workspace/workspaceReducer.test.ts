import { describe, it, expect } from "vitest";
import { workspaceReducer, initialWorkspaceState } from "./workspaceReducer.js";
import type { WorkspaceState, WorkspaceAction, ActivationHistoryRun } from "./workspaceTypes.js";
import type { EvalChange, ActivationResult } from "../../types";

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return { ...initialWorkspaceState, ...overrides };
}

function dispatch(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  return workspaceReducer(state, action);
}

const sampleChanges: EvalChange[] = [
  { action: "add", reason: "new test", eval: { id: 0, name: "new", prompt: "p", expected_output: "e", files: [], assertions: [] } },
  { action: "modify", reason: "updated", evalId: 1, eval: { id: 1, name: "mod", prompt: "p2", expected_output: "e2", files: [], assertions: [] } },
  { action: "remove", reason: "obsolete", evalId: 2 },
];

describe("workspaceReducer - AI Edit eval changes", () => {
  describe("AI_EDIT_RESULT", () => {
    it("stores eval changes and initializes all selections as true", () => {
      const state = makeState();
      const result = dispatch(state, {
        type: "AI_EDIT_RESULT",
        improved: "new content",
        reasoning: "because",
        evalChanges: sampleChanges,
      });
      expect(result.aiEditEvalChanges).toHaveLength(3);
      expect(result.aiEditEvalSelections.size).toBe(3);
      expect(result.aiEditEvalSelections.get(0)).toBe(true);
      expect(result.aiEditEvalSelections.get(1)).toBe(true);
      expect(result.aiEditEvalSelections.get(2)).toBe(true);
    });

    it("stores aiEditResult with evalChanges", () => {
      const state = makeState();
      const result = dispatch(state, {
        type: "AI_EDIT_RESULT",
        improved: "content",
        reasoning: "reason",
        evalChanges: sampleChanges,
      });
      expect(result.aiEditResult).not.toBeNull();
      expect(result.aiEditResult!.evalChanges).toHaveLength(3);
    });

    it("handles empty evalChanges array", () => {
      const state = makeState();
      const result = dispatch(state, {
        type: "AI_EDIT_RESULT",
        improved: "content",
        reasoning: "reason",
        evalChanges: [],
      });
      expect(result.aiEditEvalChanges).toHaveLength(0);
      expect(result.aiEditEvalSelections.size).toBe(0);
    });

    it("clears loading state", () => {
      const state = makeState({ aiEditLoading: true });
      const result = dispatch(state, {
        type: "AI_EDIT_RESULT",
        improved: "c",
        reasoning: "r",
        evalChanges: [],
      });
      expect(result.aiEditLoading).toBe(false);
    });
  });

  describe("TOGGLE_EVAL_CHANGE", () => {
    it("flips true to false", () => {
      const selections = new Map<number, boolean>([[0, true], [1, true]]);
      const state = makeState({ aiEditEvalSelections: selections });
      const result = dispatch(state, { type: "TOGGLE_EVAL_CHANGE", index: 0 });
      expect(result.aiEditEvalSelections.get(0)).toBe(false);
      expect(result.aiEditEvalSelections.get(1)).toBe(true);
    });

    it("flips false to true", () => {
      const selections = new Map<number, boolean>([[0, false]]);
      const state = makeState({ aiEditEvalSelections: selections });
      const result = dispatch(state, { type: "TOGGLE_EVAL_CHANGE", index: 0 });
      expect(result.aiEditEvalSelections.get(0)).toBe(true);
    });

    it("does not mutate original map", () => {
      const selections = new Map<number, boolean>([[0, true]]);
      const state = makeState({ aiEditEvalSelections: selections });
      dispatch(state, { type: "TOGGLE_EVAL_CHANGE", index: 0 });
      expect(selections.get(0)).toBe(true); // original unchanged
    });
  });

  describe("SELECT_ALL_EVAL_CHANGES", () => {
    it("sets all selections to true", () => {
      const selections = new Map<number, boolean>([[0, false], [1, false], [2, true]]);
      const state = makeState({ aiEditEvalSelections: selections });
      const result = dispatch(state, { type: "SELECT_ALL_EVAL_CHANGES" });
      for (const [, v] of result.aiEditEvalSelections) {
        expect(v).toBe(true);
      }
    });
  });

  describe("DESELECT_ALL_EVAL_CHANGES", () => {
    it("sets all selections to false", () => {
      const selections = new Map<number, boolean>([[0, true], [1, true]]);
      const state = makeState({ aiEditEvalSelections: selections });
      const result = dispatch(state, { type: "DESELECT_ALL_EVAL_CHANGES" });
      for (const [, v] of result.aiEditEvalSelections) {
        expect(v).toBe(false);
      }
    });
  });

  describe("SET_EVALS_RETRY", () => {
    it("stores evalsFile for retry", () => {
      const state = makeState();
      const evalsFile = { skill_name: "test", evals: [] };
      const result = dispatch(state, { type: "SET_EVALS_RETRY", evalsFile });
      expect(result.aiEditEvalsRetry).toEqual(evalsFile);
    });
  });

  describe("OPEN_AI_EDIT", () => {
    it("clears all eval change state", () => {
      const state = makeState({
        aiEditEvalChanges: sampleChanges,
        aiEditEvalSelections: new Map([[0, true]]),
        aiEditEvalsRetry: { skill_name: "x", evals: [] },
        aiEditResult: { improved: "x", reasoning: "r", evalChanges: [] },
        aiEditError: "some error",
      });
      const result = dispatch(state, { type: "OPEN_AI_EDIT" });
      expect(result.aiEditEvalChanges).toEqual([]);
      expect(result.aiEditEvalSelections.size).toBe(0);
      expect(result.aiEditEvalsRetry).toBeNull();
      expect(result.aiEditResult).toBeNull();
      expect(result.aiEditError).toBeNull();
      expect(result.aiEditOpen).toBe(true);
    });
  });

  describe("CLOSE_AI_EDIT", () => {
    it("clears all eval change state and closes panel", () => {
      const state = makeState({
        aiEditOpen: true,
        aiEditLoading: true,
        aiEditEvalChanges: sampleChanges,
        aiEditEvalSelections: new Map([[0, true], [1, false]]),
        aiEditEvalsRetry: { skill_name: "x", evals: [] },
      });
      const result = dispatch(state, { type: "CLOSE_AI_EDIT" });
      expect(result.aiEditOpen).toBe(false);
      expect(result.aiEditLoading).toBe(false);
      expect(result.aiEditEvalChanges).toEqual([]);
      expect(result.aiEditEvalSelections.size).toBe(0);
      expect(result.aiEditEvalsRetry).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Activation timeout and cancel reducer tests (T-009)
// ---------------------------------------------------------------------------

function makeActivationResult(prompt: string, classification: "TP" | "TN" | "FP" | "FN"): ActivationResult {
  return {
    prompt,
    expected: classification === "TP" || classification === "FN" ? "should_activate" : "should_not_activate",
    activate: classification === "TP" || classification === "FP",
    confidence: "high",
    reasoning: "test",
    classification,
  };
}

describe("workspaceReducer - Activation timeout and cancel", () => {
  describe("ACTIVATION_START", () => {
    it("sets activationRunning and activationStartedAt", () => {
      const state = makeState();
      const result = dispatch(state, { type: "ACTIVATION_START" });
      expect(result.activationRunning).toBe(true);
      expect(result.activationStartedAt).toBeGreaterThan(0);
      expect(result.activationResults).toEqual([]);
      expect(result.activationSummary).toBeNull();
      expect(result.activationError).toBeNull();
    });
  });

  describe("ACTIVATION_TIMEOUT", () => {
    it("sets activationRunning to false and shows timeout message", () => {
      const state = makeState({ activationRunning: true, activationStartedAt: Date.now() - 120000 });
      const result = dispatch(state, { type: "ACTIVATION_TIMEOUT" });
      expect(result.activationRunning).toBe(false);
      expect(result.activationError).toContain("timed out");
      expect(result.activationError).toContain("120");
    });

    it("preserves partial results on timeout", () => {
      const partialResults = [
        makeActivationResult("test1", "TP"),
        makeActivationResult("test2", "TN"),
      ];
      const state = makeState({
        activationRunning: true,
        activationResults: partialResults,
      });
      const result = dispatch(state, { type: "ACTIVATION_TIMEOUT" });
      expect(result.activationRunning).toBe(false);
      expect(result.activationResults).toHaveLength(2);
      expect(result.activationResults[0].prompt).toBe("test1");
    });
  });

  describe("ACTIVATION_CANCEL", () => {
    it("sets activationRunning to false", () => {
      const state = makeState({ activationRunning: true });
      const result = dispatch(state, { type: "ACTIVATION_CANCEL", totalPrompts: 5 });
      expect(result.activationRunning).toBe(false);
    });

    it("preserves completed results (3 of 5 completed)", () => {
      const completedResults = [
        makeActivationResult("prompt1", "TP"),
        makeActivationResult("prompt2", "TN"),
        makeActivationResult("prompt3", "FP"),
      ];
      const state = makeState({
        activationRunning: true,
        activationResults: completedResults,
      });
      const result = dispatch(state, { type: "ACTIVATION_CANCEL", totalPrompts: 5 });
      expect(result.activationRunning).toBe(false);
      expect(result.activationResults).toHaveLength(3);
      expect(result.activationResults[0].classification).toBe("TP");
      expect(result.activationResults[1].classification).toBe("TN");
      expect(result.activationResults[2].classification).toBe("FP");
    });

    it("handles cancel with 0 completed results", () => {
      const state = makeState({
        activationRunning: true,
        activationResults: [],
      });
      const result = dispatch(state, { type: "ACTIVATION_CANCEL", totalPrompts: 5 });
      expect(result.activationRunning).toBe(false);
      expect(result.activationResults).toHaveLength(0);
    });
  });

  describe("state transitions", () => {
    it("ACTIVATION_START -> ACTIVATION_RESULT -> ACTIVATION_TIMEOUT preserves partial", () => {
      let state = makeState();
      state = dispatch(state, { type: "ACTIVATION_START" });
      expect(state.activationRunning).toBe(true);

      state = dispatch(state, { type: "ACTIVATION_RESULT", result: makeActivationResult("p1", "TP") });
      state = dispatch(state, { type: "ACTIVATION_RESULT", result: makeActivationResult("p2", "TN") });
      expect(state.activationResults).toHaveLength(2);

      state = dispatch(state, { type: "ACTIVATION_TIMEOUT" });
      expect(state.activationRunning).toBe(false);
      expect(state.activationResults).toHaveLength(2);
      expect(state.activationError).toContain("timed out");
    });

    it("ACTIVATION_START -> ACTIVATION_RESULT -> ACTIVATION_CANCEL preserves partial", () => {
      let state = makeState();
      state = dispatch(state, { type: "ACTIVATION_START" });
      state = dispatch(state, { type: "ACTIVATION_RESULT", result: makeActivationResult("p1", "TP") });
      state = dispatch(state, { type: "ACTIVATION_RESULT", result: makeActivationResult("p2", "FN") });
      state = dispatch(state, { type: "ACTIVATION_RESULT", result: makeActivationResult("p3", "TN") });

      state = dispatch(state, { type: "ACTIVATION_CANCEL", totalPrompts: 5 });
      expect(state.activationRunning).toBe(false);
      expect(state.activationResults).toHaveLength(3);
    });
  });
});

// ---------------------------------------------------------------------------
// AI Prompt Generation reducer tests (T-011)
// ---------------------------------------------------------------------------

describe("workspaceReducer - AI Prompt Generation", () => {
  describe("GENERATE_PROMPTS_START", () => {
    it("sets generatingPrompts to true and clears error", () => {
      const state = makeState({ generatingPromptsError: "old error" });
      const result = dispatch(state, { type: "GENERATE_PROMPTS_START" });
      expect(result.generatingPrompts).toBe(true);
      expect(result.generatingPromptsError).toBeNull();
    });
  });

  describe("GENERATE_PROMPTS_DONE", () => {
    it("sets generatingPrompts to false", () => {
      const state = makeState({ generatingPrompts: true });
      const result = dispatch(state, { type: "GENERATE_PROMPTS_DONE" });
      expect(result.generatingPrompts).toBe(false);
    });
  });

  describe("GENERATE_PROMPTS_ERROR", () => {
    it("sets generatingPrompts to false and stores error", () => {
      const state = makeState({ generatingPrompts: true });
      const result = dispatch(state, { type: "GENERATE_PROMPTS_ERROR", error: "LLM failed" });
      expect(result.generatingPrompts).toBe(false);
      expect(result.generatingPromptsError).toBe("LLM failed");
    });
  });
});

// ---------------------------------------------------------------------------
// Activation History reducer tests (T-021)
// ---------------------------------------------------------------------------

function makeHistoryRun(id: string, reliability: number): ActivationHistoryRun {
  return {
    id,
    timestamp: new Date().toISOString(),
    model: "claude-sonnet",
    provider: "claude-cli",
    promptCount: 8,
    summary: {
      precision: 0.9,
      recall: 0.85,
      reliability,
      tp: 4,
      tn: 3,
      fp: 0,
      fn: 1,
    },
  };
}

describe("workspaceReducer - Activation History", () => {
  describe("ACTIVATION_HISTORY_LOADED", () => {
    it("stores history runs and sets loading to false", () => {
      const runs = [makeHistoryRun("run-1", 0.875), makeHistoryRun("run-2", 0.75)];
      const state = makeState({ activationHistoryLoading: true });
      const result = dispatch(state, { type: "ACTIVATION_HISTORY_LOADED", runs });
      expect(result.activationHistory).toHaveLength(2);
      expect(result.activationHistory![0].id).toBe("run-1");
      expect(result.activationHistoryLoading).toBe(false);
    });

    it("handles empty history", () => {
      const state = makeState();
      const result = dispatch(state, { type: "ACTIVATION_HISTORY_LOADED", runs: [] });
      expect(result.activationHistory).toEqual([]);
    });
  });

  describe("initial state", () => {
    it("has correct defaults for new fields", () => {
      expect(initialWorkspaceState.generatingPrompts).toBe(false);
      expect(initialWorkspaceState.generatingPromptsError).toBeNull();
      expect(initialWorkspaceState.activationHistory).toBeNull();
      expect(initialWorkspaceState.activationHistoryLoading).toBe(false);
    });
  });
});
