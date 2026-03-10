import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { useMultiSSE } from "../../sse";
import type { EvalsFile, BenchmarkResult } from "../../types";
import type { WorkspaceContextValue, PanelId, RunMode, InlineResult, AssertionResultInline } from "./workspaceTypes";
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

  const { streams, startCase: sseStartCase, stopCase: sseStopCase, stopAll: sseStopAll, isAnyCaseRunning } = useMultiSSE();

  // Track bulk run completion
  const bulkPendingRef = useRef<Set<number>>(new Set());

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
  // Process per-case SSE streams → dispatch inline results
  // ---------------------------------------------------------------------------
  useEffect(() => {
    for (const [caseId, stream] of streams) {
      // Build inline result from events
      const r: InlineResult = { assertions: [] };

      for (const evt of stream.events) {
        const data = evt.data as Record<string, unknown>;

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
      }

      dispatch({ type: "UPDATE_INLINE_RESULT", evalId: caseId, result: { ...r } });

      // If stream finished, update case run state
      if (!stream.running && stream.done) {
        dispatch({ type: "CASE_RUN_COMPLETE", caseId, result: { ...r } });
        // Track bulk completion
        if (bulkPendingRef.current.has(caseId)) {
          bulkPendingRef.current.delete(caseId);
          if (bulkPendingRef.current.size === 0) {
            // All bulk cases done — fetch latest benchmark and complete
            api.getLatestBenchmark(plugin, skill)
              .then((b) => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: b }))
              .catch(() => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: null }));
          }
        }
      } else if (!stream.running && stream.error) {
        dispatch({ type: "CASE_RUN_ERROR", caseId, error: stream.error });
        if (bulkPendingRef.current.has(caseId)) {
          bulkPendingRef.current.delete(caseId);
          if (bulkPendingRef.current.size === 0) {
            api.getLatestBenchmark(plugin, skill)
              .then((b) => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: b }))
              .catch(() => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: null }));
          }
        }
      }
    }
  }, [streams, plugin, skill]);

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

  // -- Per-case run --
  const runCase = useCallback((caseId: number, mode: RunMode = "benchmark") => {
    const caseState = state.caseRunStates.get(caseId);
    if (caseState?.status === "running") return; // already running

    dispatch({ type: "CASE_RUN_START", caseId, mode });

    if (mode === "comparison") {
      // Comparison uses the bulk endpoint with eval_ids filter (different flow)
      const url = `/api/skills/${plugin}/${skill}/compare`;
      sseStartCase(caseId, url, { eval_ids: [caseId] });
    } else {
      const url = `/api/skills/${plugin}/${skill}/benchmark/case/${caseId}`;
      const body = mode === "baseline" ? { baseline_only: true } : undefined;
      sseStartCase(caseId, url, body);
    }
  }, [plugin, skill, state.caseRunStates, sseStartCase]);

  // -- Run all cases in parallel --
  const runAll = useCallback((mode: RunMode = "benchmark") => {
    const cases = state.evals?.evals ?? [];
    if (cases.length === 0) return;

    const caseIds = cases.map((c) => c.id);
    dispatch({ type: "BULK_RUN_START", caseIds, mode });

    bulkPendingRef.current = new Set(caseIds);

    for (const id of caseIds) {
      if (mode === "comparison") {
        sseStartCase(id, `/api/skills/${plugin}/${skill}/compare`, { eval_ids: [id] });
      } else {
        const url = `/api/skills/${plugin}/${skill}/benchmark/case/${id}`;
        const body = mode === "baseline" ? { baseline_only: true } : undefined;
        sseStartCase(id, url, body);
      }
    }
  }, [plugin, skill, state.evals, sseStartCase]);

  // -- Cancel per-case --
  const cancelCase = useCallback((caseId: number) => {
    sseStopCase(caseId);
    dispatch({ type: "CASE_RUN_CANCEL", caseId });
    bulkPendingRef.current.delete(caseId);
  }, [sseStopCase]);

  // -- Cancel all --
  const cancelAll = useCallback(() => {
    sseStopAll();
    dispatch({ type: "CANCEL_ALL" });
    bulkPendingRef.current.clear();
  }, [sseStopAll]);

  const improveForCase = useCallback(async (evalId: number, notes?: string) => {
    dispatch({ type: "OPEN_IMPROVE", evalId });
  }, []);

  const applyImproveAndRerun = useCallback(async (evalId: number, improved: string) => {
    try {
      await api.applyImprovement(plugin, skill, improved);
      dispatch({ type: "SET_CONTENT", content: improved });
      dispatch({ type: "CONTENT_SAVED" });
      dispatch({ type: "CLOSE_IMPROVE" });
      runCase(evalId, "benchmark");
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill, runCase]);

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
    runCase,
    runAll,
    cancelCase,
    cancelAll,
    improveForCase,
    applyImproveAndRerun,
    refreshSkillContent,
    generateEvals,
  }), [state, saveContent, saveEvals, runCase, runAll, cancelCase, cancelAll, improveForCase, applyImproveAndRerun, refreshSkillContent, generateEvals]);

  return (
    <WorkspaceCtx.Provider value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
