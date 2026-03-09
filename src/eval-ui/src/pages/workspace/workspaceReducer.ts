import type { WorkspaceState, WorkspaceAction, InlineResult } from "./workspaceTypes";

export const initialWorkspaceState: WorkspaceState = {
  plugin: "",
  skill: "",
  skillContent: "",
  savedContent: "",
  isDirty: false,
  evals: null,
  activePanel: "tests",
  selectedCaseId: null,
  isRunning: false,
  runMode: null,
  runScope: null,
  latestBenchmark: null,
  inlineResults: new Map(),
  improveTarget: null,
  regressions: [],
  iterationCount: 0,
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
      // Auto-select first case
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

    case "RUN_START":
      return {
        ...state,
        isRunning: true,
        runMode: action.mode,
        runScope: action.scope,
        activePanel: "run",
      };

    case "RUN_COMPLETE": {
      const inlineResults = new Map(state.inlineResults);
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
      return {
        ...state,
        isRunning: false,
        latestBenchmark: action.benchmark,
        inlineResults,
        iterationCount: state.iterationCount + 1,
      };
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

    case "SET_REGRESSIONS":
      return { ...state, regressions: action.regressions };

    case "INCREMENT_ITERATION":
      return { ...state, iterationCount: state.iterationCount + 1 };

    default:
      return state;
  }
}
