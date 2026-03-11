import { describe, it, expect } from "vitest";
import { workspaceReducer, initialWorkspaceState } from "./workspaceReducer.js";
import type { WorkspaceState, WorkspaceAction } from "./workspaceTypes.js";
import type { EvalChange } from "../../types";

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
