import { createContext, useContext, useReducer, useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useSSE } from "../../sse";
import type { EvalsFile, BenchmarkResult } from "../../types";
import type { WorkspaceContextValue, PanelId, RunMode, RunScope, InlineResult, AssertionResultInline } from "./workspaceTypes";
import { workspaceReducer, initialWorkspaceState } from "./workspaceReducer";

const WorkspaceCtx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

interface Props {
  plugin: string;
  skill: string;
  children: React.ReactNode;
}

export function WorkspaceProvider({ plugin, skill, children }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(workspaceReducer, {
    ...initialWorkspaceState,
    plugin,
    skill,
  });

  const { events, running: sseRunning, start: sseStart } = useSSE();

  // ---------------------------------------------------------------------------
  // Sync panel from URL
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const panelParam = searchParams.get("panel") as PanelId | null;
    if (panelParam && ["editor", "tests", "run", "history", "deps"].includes(panelParam)) {
      dispatch({ type: "SET_PANEL", panel: panelParam });
    }
  }, []); // only on mount

  // Sync panel TO url
  useEffect(() => {
    const current = searchParams.get("panel");
    if (current !== state.activePanel) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("panel", state.activePanel);
        return next;
      }, { replace: true });
    }
  }, [state.activePanel]);

  // ---------------------------------------------------------------------------
  // Initial data fetch
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [detail, evals, benchmark] = await Promise.allSettled([
          api.getSkillDetail(plugin, skill),
          api.getEvals(plugin, skill),
          api.getLatestBenchmark(plugin, skill),
        ]);

        if (cancelled) return;

        dispatch({
          type: "INIT_DATA",
          skillContent: detail.status === "fulfilled" ? detail.value.skillContent : "",
          evals: evals.status === "fulfilled" ? evals.value : null,
          benchmark: benchmark.status === "fulfilled" ? benchmark.value : null,
        });
      } catch (e) {
        if (!cancelled) dispatch({ type: "SET_ERROR", error: (e as Error).message });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [plugin, skill]);

  // ---------------------------------------------------------------------------
  // SSE event processing (benchmark streaming)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!state.isRunning || !state.runScope) return;

    // Track per-case inline results from SSE
    const caseResults = new Map<number, InlineResult>();

    for (const evt of events) {
      const data = evt.data as Record<string, unknown>;
      const evalId = data.eval_id as number;

      if (!caseResults.has(evalId)) {
        caseResults.set(evalId, { assertions: [] });
      }
      const r = caseResults.get(evalId)!;

      if (evt.event === "output_ready") {
        r.output = data.output as string;
        if (data.durationMs != null) r.durationMs = data.durationMs as number;
        if (data.tokens != null) r.tokens = data.tokens as number | null;
      }

      if (evt.event === "assertion_result") {
        const ar: AssertionResultInline = {
          assertion_id: data.assertion_id as string,
          text: data.text as string,
          pass: data.pass as boolean,
          reasoning: data.reasoning as string,
        };
        if (!r.assertions.find((a) => a.assertion_id === ar.assertion_id)) {
          r.assertions.push(ar);
        }
      }

      if (evt.event === "case_complete") {
        r.status = data.status as string;
        r.passRate = data.pass_rate as number | undefined;
        r.errorMessage = (data.error_message as string) || undefined;
      }

      dispatch({ type: "UPDATE_INLINE_RESULT", evalId, result: { ...r } });
    }
  }, [events, state.isRunning, state.runScope]);

  // Handle SSE done
  useEffect(() => {
    if (!sseRunning && state.isRunning) {
      // Fetch final benchmark result
      api.getLatestBenchmark(plugin, skill)
        .then((b) => dispatch({ type: "RUN_COMPLETE", benchmark: b }))
        .catch(() => dispatch({ type: "RUN_COMPLETE", benchmark: state.latestBenchmark! }));
    }
  }, [sseRunning]);

  // ---------------------------------------------------------------------------
  // Async actions
  // ---------------------------------------------------------------------------
  const saveContent = useCallback(async () => {
    try {
      await api.applyImprovement(plugin, skill, state.skillContent);
      dispatch({ type: "CONTENT_SAVED" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill, state.skillContent]);

  const saveEvals = useCallback(async (updated: EvalsFile) => {
    try {
      const saved = await api.saveEvals(plugin, skill, updated);
      dispatch({ type: "SET_EVALS", evals: saved });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill]);

  const runBenchmark = useCallback((mode: RunMode, scope: RunScope) => {
    if (state.isRunning) return; // prevent concurrent runs

    dispatch({ type: "RUN_START", mode, scope });

    const evalIds = scope === "all"
      ? undefined
      : [scope.caseId];

    const url = mode === "comparison"
      ? `/api/skills/${plugin}/${skill}/compare`
      : mode === "baseline"
        ? `/api/skills/${plugin}/${skill}/benchmark`
        : `/api/skills/${plugin}/${skill}/benchmark`;

    const body = mode === "baseline"
      ? { eval_ids: evalIds, baseline_only: true }
      : { eval_ids: evalIds };

    sseStart(url, body);
  }, [plugin, skill, state.isRunning, sseStart]);

  const improveForCase = useCallback(async (evalId: number, notes?: string) => {
    dispatch({ type: "OPEN_IMPROVE", evalId });
    // The actual improve call happens in the EditorPanel via SkillImprovePanel
  }, []);

  const applyImproveAndRerun = useCallback(async (evalId: number, improved: string) => {
    try {
      await api.applyImprovement(plugin, skill, improved);
      dispatch({ type: "SET_CONTENT", content: improved });
      dispatch({ type: "CONTENT_SAVED" });
      dispatch({ type: "CLOSE_IMPROVE" });
      // Rerun the case
      runBenchmark("benchmark", { caseId: evalId });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill, runBenchmark]);

  const refreshSkillContent = useCallback(async () => {
    try {
      const d = await api.getSkillDetail(plugin, skill);
      dispatch({ type: "SET_CONTENT", content: d.skillContent });
      dispatch({ type: "CONTENT_SAVED" });
    } catch {}
  }, [plugin, skill]);

  const generateEvals = useCallback(async () => {
    try {
      const generated = await api.generateEvals(plugin, skill);
      const saved = await api.saveEvals(plugin, skill, generated);
      dispatch({ type: "SET_EVALS", evals: saved });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    state,
    dispatch,
    saveContent,
    saveEvals,
    runBenchmark,
    improveForCase,
    applyImproveAndRerun,
    refreshSkillContent,
    generateEvals,
  }), [state, saveContent, saveEvals, runBenchmark, improveForCase, applyImproveAndRerun, refreshSkillContent, generateEvals]);

  return (
    <WorkspaceCtx.Provider value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
