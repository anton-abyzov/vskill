import type { WorkspaceState, WorkspaceAction, InlineResult, CaseRunState } from "./workspaceTypes";

export const initialWorkspaceState: WorkspaceState = {
  plugin: "",
  skill: "",
  skillContent: "",
  savedContent: "",
  isDirty: false,
  evals: null,
  activePanel: "tests",
  selectedCaseId: null,
  caseRunStates: new Map(),
  bulkRunActive: false,
  runMode: null,
  latestBenchmark: null,
  inlineResults: new Map(),
  improveTarget: null,
  aiEditOpen: false,
  aiEditLoading: false,
  aiEditResult: null,
  aiEditError: null,
  aiEditEvalChanges: [],
  aiEditEvalSelections: new Map(),
  aiEditEvalsRetry: null,
  regressions: [],
  iterationCount: 0,
  activationPrompts: "",
  activationResults: [],
  activationSummary: null,
  activationRunning: false,
  activationError: null,
  loading: true,
  error: null,
};

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "SET_LOADING":
      return { ...state, loading: action.loading };

    case "SET_ERROR":
      return { ...state, error: action.error };

    case "INIT_DATA": {
      const inlineResults = new Map<number, InlineResult>();
      if (action.benchmark) {
        for (const c of action.benchmark.cases) {
          inlineResults.set(c.eval_id, {
            status: c.status,
            passRate: c.pass_rate,
            errorMessage: c.error_message || undefined,
            durationMs: c.durationMs,
            tokens: c.tokens,
            output: c.output,
            assertions: c.assertions.map((a) => ({
              assertion_id: a.id,
              text: a.text,
              pass: a.pass,
              reasoning: a.reasoning,
            })),
          });
        }
      }
      const firstCaseId = action.evals?.evals[0]?.id ?? null;
      return {
        ...state,
        skillContent: action.skillContent,
        savedContent: action.skillContent,
        isDirty: false,
        evals: action.evals,
        latestBenchmark: action.benchmark,
        inlineResults,
        selectedCaseId: firstCaseId,
        loading: false,
        error: null,
      };
    }

    case "SET_PANEL":
      return { ...state, activePanel: action.panel };

    case "SET_CONTENT":
      return {
        ...state,
        skillContent: action.content,
        isDirty: action.content !== state.savedContent,
      };

    case "CONTENT_SAVED":
      return {
        ...state,
        savedContent: state.skillContent,
        isDirty: false,
      };

    case "SET_EVALS":
      return { ...state, evals: action.evals };

    case "SELECT_CASE":
      return { ...state, selectedCaseId: action.caseId };

    // -- Per-case run lifecycle --

    case "CASE_RUN_START": {
      const caseRunStates = new Map(state.caseRunStates);
      caseRunStates.set(action.caseId, { status: "running", startedAt: Date.now(), mode: action.mode });
      return {
        ...state,
        caseRunStates,
        runMode: action.mode,
        activePanel: "run",
      };
    }

    case "CASE_RUN_COMPLETE": {
      const caseRunStates = new Map(state.caseRunStates);
      const prev = caseRunStates.get(action.caseId);
      caseRunStates.set(action.caseId, { status: "complete", mode: prev?.mode });
      const inlineResults = new Map(state.inlineResults);
      inlineResults.set(action.caseId, action.result);
      return { ...state, caseRunStates, inlineResults };
    }

    case "CASE_RUN_ERROR": {
      const caseRunStates = new Map(state.caseRunStates);
      const prev = caseRunStates.get(action.caseId);
      caseRunStates.set(action.caseId, { status: "error", mode: prev?.mode });
      const inlineResults = new Map(state.inlineResults);
      inlineResults.set(action.caseId, {
        status: "error",
        errorMessage: action.error,
        assertions: [],
      });
      return { ...state, caseRunStates, inlineResults };
    }

    case "CASE_RUN_CANCEL": {
      const caseRunStates = new Map(state.caseRunStates);
      const prev = caseRunStates.get(action.caseId);
      caseRunStates.set(action.caseId, { status: "cancelled", mode: prev?.mode });
      return { ...state, caseRunStates };
    }

    // -- Bulk run lifecycle --

    case "BULK_RUN_START": {
      const caseRunStates = new Map(state.caseRunStates);
      for (const id of action.caseIds) {
        caseRunStates.set(id, { status: "queued", mode: action.mode });
      }
      return {
        ...state,
        caseRunStates,
        bulkRunActive: true,
        runMode: action.mode,
        activePanel: "run",
      };
    }

    case "BULK_RUN_COMPLETE": {
      return {
        ...state,
        bulkRunActive: false,
        latestBenchmark: action.benchmark ?? state.latestBenchmark,
        iterationCount: state.iterationCount + 1,
      };
    }

    case "CANCEL_ALL": {
      const caseRunStates = new Map(state.caseRunStates);
      for (const [id, s] of caseRunStates) {
        if (s.status === "running" || s.status === "queued") {
          caseRunStates.set(id, { status: "cancelled" });
        }
      }
      return { ...state, caseRunStates, bulkRunActive: false };
    }

    case "UPDATE_INLINE_RESULT": {
      const inlineResults = new Map(state.inlineResults);
      inlineResults.set(action.evalId, action.result);
      return { ...state, inlineResults };
    }

    case "OPEN_IMPROVE":
      return {
        ...state,
        improveTarget: action.evalId,
        activePanel: "editor",
      };

    case "CLOSE_IMPROVE":
      return { ...state, improveTarget: null };

    // -- AI Edit lifecycle --

    case "OPEN_AI_EDIT":
      return { ...state, aiEditOpen: true, aiEditResult: null, aiEditError: null, aiEditEvalChanges: [], aiEditEvalSelections: new Map(), aiEditEvalsRetry: null };

    case "CLOSE_AI_EDIT":
      return { ...state, aiEditOpen: false, aiEditLoading: false, aiEditResult: null, aiEditError: null, aiEditEvalChanges: [], aiEditEvalSelections: new Map(), aiEditEvalsRetry: null };

    case "AI_EDIT_LOADING":
      return { ...state, aiEditLoading: true, aiEditError: null };

    case "AI_EDIT_RESULT": {
      const evalChanges = action.evalChanges ?? [];
      const selections = new Map<number, boolean>();
      for (let i = 0; i < evalChanges.length; i++) selections.set(i, true);
      return {
        ...state,
        aiEditLoading: false,
        aiEditResult: { improved: action.improved, reasoning: action.reasoning, evalChanges },
        aiEditEvalChanges: evalChanges,
        aiEditEvalSelections: selections,
      };
    }

    case "AI_EDIT_ERROR":
      return { ...state, aiEditLoading: false, aiEditError: action.message };

    case "TOGGLE_EVAL_CHANGE": {
      const selections = new Map(state.aiEditEvalSelections);
      selections.set(action.index, !selections.get(action.index));
      return { ...state, aiEditEvalSelections: selections };
    }

    case "SELECT_ALL_EVAL_CHANGES": {
      const selections = new Map(state.aiEditEvalSelections);
      for (const key of selections.keys()) selections.set(key, true);
      return { ...state, aiEditEvalSelections: selections };
    }

    case "DESELECT_ALL_EVAL_CHANGES": {
      const selections = new Map(state.aiEditEvalSelections);
      for (const key of selections.keys()) selections.set(key, false);
      return { ...state, aiEditEvalSelections: selections };
    }

    case "SET_EVALS_RETRY":
      return { ...state, aiEditEvalsRetry: action.evalsFile };

    case "SET_REGRESSIONS":
      return { ...state, regressions: action.regressions };

    case "INCREMENT_ITERATION":
      return { ...state, iterationCount: state.iterationCount + 1 };

    // -- Activation test lifecycle --

    case "SET_ACTIVATION_PROMPTS":
      return { ...state, activationPrompts: action.prompts };

    case "ACTIVATION_START":
      return { ...state, activationRunning: true, activationResults: [], activationSummary: null, activationError: null };

    case "ACTIVATION_RESULT":
      return { ...state, activationResults: [...state.activationResults, action.result] };

    case "ACTIVATION_DONE":
      return { ...state, activationRunning: false, activationSummary: action.summary };

    case "ACTIVATION_ERROR":
      return { ...state, activationRunning: false, activationError: action.error };

    case "ACTIVATION_RESET":
      return { ...state, activationResults: [], activationSummary: null, activationError: null };

    default:
      return state;
  }
}
