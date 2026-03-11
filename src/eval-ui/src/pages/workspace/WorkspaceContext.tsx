import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../../api";
import { useMultiSSE, useSSE } from "../../sse";
import type { SSEEvent } from "../../sse";
import type { ActivationResult, ActivationSummary } from "../../types";
import type { EvalsFile, BenchmarkResult, EvalChange } from "../../types";
import type { ClassifiedError } from "../../components/ErrorCard";
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
  const [state, dispatch] = useReducer(workspaceReducer, {
    ...initialWorkspaceState,
    plugin,
    skill,
  });

  // Track bulk run completion — mutable ref, no re-renders
  const bulkPendingRef = useRef<Set<number>>(new Set());
  const completedCasesRef = useRef<Set<number>>(new Set());

  // Per-case accumulated inline results — mutable ref, dispatched incrementally
  const inlineAccRef = useRef<Map<number, InlineResult>>(new Map());

  // ---------------------------------------------------------------------------
  // SSE callbacks — fire exactly once per event, no accumulation
  // ---------------------------------------------------------------------------
  const handleSSEEvent = useCallback((caseId: number, evt: SSEEvent) => {
    const data = evt.data as Record<string, unknown>;

    // Get or create mutable accumulator for this case
    let r = inlineAccRef.current.get(caseId);
    if (!r) {
      r = { assertions: [] };
      inlineAccRef.current.set(caseId, r);
    }

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

    // Dispatch a snapshot (shallow copy) for React
    dispatch({ type: "UPDATE_INLINE_RESULT", evalId: caseId, result: { ...r, assertions: [...r.assertions] } });
  }, []);

  const handleSSEDone = useCallback((caseId: number) => {
    // Guard against duplicate completion
    if (completedCasesRef.current.has(caseId)) return;
    completedCasesRef.current.add(caseId);

    const r = inlineAccRef.current.get(caseId) ?? { assertions: [] };
    dispatch({ type: "CASE_RUN_COMPLETE", caseId, result: { ...r, assertions: [...r.assertions] } });

    // Track bulk completion
    if (bulkPendingRef.current.has(caseId)) {
      bulkPendingRef.current.delete(caseId);
      if (bulkPendingRef.current.size === 0) {
        api.getLatestBenchmark(plugin, skill)
          .then((b) => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: b }))
          .catch(() => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: null }));
      }
    }
  }, [plugin, skill]);

  const handleSSEError = useCallback((caseId: number, error: string) => {
    if (completedCasesRef.current.has(caseId)) return;
    completedCasesRef.current.add(caseId);

    dispatch({ type: "CASE_RUN_ERROR", caseId, error });

    if (bulkPendingRef.current.has(caseId)) {
      bulkPendingRef.current.delete(caseId);
      if (bulkPendingRef.current.size === 0) {
        api.getLatestBenchmark(plugin, skill)
          .then((b) => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: b }))
          .catch(() => dispatch({ type: "BULK_RUN_COMPLETE", benchmark: null }));
      }
    }
  }, [plugin, skill]);

  const { startCase: sseStartCase, stopCase: sseStopCase, stopAll: sseStopAll } = useMultiSSE({
    onEvent: handleSSEEvent,
    onDone: handleSSEDone,
    onError: handleSSEError,
  });

  // ---------------------------------------------------------------------------
  // Cleanup SSE connections on unmount (prevents orphaned streams on skill switch)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => { sseStopAll(); };
  }, [sseStopAll]);

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

    // Reset accumulators for this case
    inlineAccRef.current.delete(caseId);
    completedCasesRef.current.delete(caseId);

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

    // Reset all accumulators
    for (const id of caseIds) {
      inlineAccRef.current.delete(id);
      completedCasesRef.current.delete(id);
    }

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
    completedCasesRef.current.add(caseId); // prevent late callbacks
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

  // -- AI Edit (SSE-backed) --
  const aiEditSSE = useSSE();
  const aiEditAbortRef = useRef<(() => void) | null>(null);

  // Process AI Edit SSE events
  useEffect(() => {
    if (!aiEditSSE.events.length) return;
    for (const evt of aiEditSSE.events) {
      const data = evt.data as Record<string, unknown>;
      if (evt.event === "progress") {
        dispatch({
          type: "AI_EDIT_PROGRESS",
          entry: {
            timestamp: Date.now(),
            phase: data.phase as string,
            message: data.message as string,
          },
        });
      }
      if (evt.event === "done") {
        const improved = data.improved as string;
        const reasoning = data.reasoning as string;
        const evalChanges = (data.evalChanges as EvalChange[]) ?? [];
        dispatch({ type: "AI_EDIT_RESULT", improved, reasoning, evalChanges });
      }
      if (evt.event === "error") {
        const classified = data as unknown as ClassifiedError;
        dispatch({
          type: "AI_EDIT_ERROR",
          message: classified.description || "Unknown error",
          classified,
        });
      }
    }
  }, [aiEditSSE.events]);

  useEffect(() => {
    if (aiEditSSE.error) {
      dispatch({ type: "AI_EDIT_ERROR", message: aiEditSSE.error });
    }
  }, [aiEditSSE.error]);

  // Cleanup AI Edit SSE on unmount
  useEffect(() => {
    return () => { aiEditSSE.stop(); };
  }, [aiEditSSE.stop]);

  const submitAiEdit = useCallback(async (instruction: string, provider?: string, model?: string) => {
    dispatch({ type: "AI_EDIT_LOADING" });
    aiEditAbortRef.current = aiEditSSE.stop;
    aiEditSSE.start(`/api/skills/${plugin}/${skill}/improve?sse`, {
      mode: "instruct",
      instruction,
      content: state.skillContent,
      evals: state.evals ?? { skill_name: skill, evals: [] },
      provider,
      model,
    });
  }, [plugin, skill, state.skillContent, state.evals, aiEditSSE]);

  const cancelAiEdit = useCallback(() => {
    aiEditSSE.stop();
    dispatch({ type: "AI_EDIT_ERROR", message: "Cancelled" });
  }, [aiEditSSE]);

  const applyAiEdit = useCallback(async () => {
    const result = state.aiEditResult;
    if (!result?.improved) return;
    try {
      // Phase 1: save SKILL.md
      await api.applyImprovement(plugin, skill, result.improved);
      dispatch({ type: "SET_CONTENT", content: result.improved });
      dispatch({ type: "CONTENT_SAVED" });

      // Phase 2: apply selected eval changes
      const hasSelectedChanges = state.aiEditEvalChanges.length > 0
        && Array.from(state.aiEditEvalSelections.values()).some(Boolean);
      if (hasSelectedChanges) {
        const { mergeEvalChanges } = await import("../../utils/mergeEvalChanges");
        const currentEvals = state.evals ?? { skill_name: skill, evals: [] };
        const merged = mergeEvalChanges(currentEvals, state.aiEditEvalChanges, state.aiEditEvalSelections);
        try {
          const saved = await api.saveEvals(plugin, skill, merged);
          dispatch({ type: "SET_EVALS", evals: saved });
        } catch (e) {
          // SKILL.md saved, but evals failed — store for retry
          dispatch({ type: "SET_EVALS_RETRY", evalsFile: merged });
          dispatch({ type: "SET_ERROR", error: `SKILL.md saved, but test cases failed to save: ${(e as Error).message}. You can retry from the AI Edit panel.` });
          return; // don't close — allow retry
        }
      }

      dispatch({ type: "CLOSE_AI_EDIT" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill, state.aiEditResult, state.evals, state.aiEditEvalChanges, state.aiEditEvalSelections]);

  const discardAiEdit = useCallback(() => {
    dispatch({ type: "CLOSE_AI_EDIT" });
  }, []);

  const toggleEvalChange = useCallback((index: number) => {
    dispatch({ type: "TOGGLE_EVAL_CHANGE", index });
  }, []);

  const selectAllEvalChanges = useCallback(() => {
    dispatch({ type: "SELECT_ALL_EVAL_CHANGES" });
  }, []);

  const deselectAllEvalChanges = useCallback(() => {
    dispatch({ type: "DESELECT_ALL_EVAL_CHANGES" });
  }, []);

  const retryEvalsSave = useCallback(async () => {
    const merged = state.aiEditEvalsRetry;
    if (!merged) return;
    try {
      const saved = await api.saveEvals(plugin, skill, merged);
      dispatch({ type: "SET_EVALS", evals: saved });
      dispatch({ type: "CLOSE_AI_EDIT" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: `Retry failed: ${(e as Error).message}` });
    }
  }, [plugin, skill, state.aiEditEvalsRetry]);

  const refreshSkillContent = useCallback(async () => {
    try {
      const d = await api.getSkillDetail(plugin, skill);
      dispatch({ type: "SET_CONTENT", content: d.skillContent });
      dispatch({ type: "CONTENT_SAVED" });
    } catch {}
  }, [plugin, skill]);

  // -- Generate Evals (SSE-backed) --
  const genEvalsSSE = useSSE();

  // Process Generate Evals SSE events
  useEffect(() => {
    if (!genEvalsSSE.events.length) return;
    for (const evt of genEvalsSSE.events) {
      const data = evt.data as Record<string, unknown>;
      if (evt.event === "progress") {
        dispatch({
          type: "GENERATE_EVALS_PROGRESS",
          entry: {
            timestamp: Date.now(),
            phase: data.phase as string,
            message: data.message as string,
          },
        });
      }
      if (evt.event === "done") {
        // Save the generated evals to disk, then update state
        const evalsFile = data as unknown as EvalsFile;
        api.saveEvals(plugin, skill, evalsFile)
          .then((saved) => dispatch({ type: "GENERATE_EVALS_DONE", evals: saved }))
          .catch((e) => dispatch({ type: "SET_ERROR", error: (e as Error).message }));
      }
      if (evt.event === "error") {
        dispatch({ type: "GENERATE_EVALS_ERROR", classified: data as unknown as ClassifiedError });
      }
    }
  }, [genEvalsSSE.events, plugin, skill]);

  useEffect(() => {
    if (genEvalsSSE.error) {
      dispatch({ type: "SET_ERROR", error: genEvalsSSE.error });
    }
  }, [genEvalsSSE.error]);

  useEffect(() => {
    return () => { genEvalsSSE.stop(); };
  }, [genEvalsSSE.stop]);

  const generateEvals = useCallback(async () => {
    dispatch({ type: "GENERATE_EVALS_START" });
    genEvalsSSE.start(`/api/skills/${plugin}/${skill}/generate-evals?sse`);
  }, [plugin, skill, genEvalsSSE]);

  // ---------------------------------------------------------------------------
  // Activation test SSE
  // ---------------------------------------------------------------------------
  const activationSSE = useSSE();

  // Cleanup activation SSE on unmount
  useEffect(() => {
    return () => { activationSSE.stop(); };
  }, [activationSSE.stop]);

  // Process activation SSE events
  useEffect(() => {
    if (!activationSSE.events.length) return;
    for (const evt of activationSSE.events) {
      if (evt.event === "prompt_result") {
        dispatch({ type: "ACTIVATION_RESULT", result: evt.data as ActivationResult });
      }
      if (evt.event === "done") {
        dispatch({ type: "ACTIVATION_DONE", summary: evt.data as ActivationSummary & { description?: string } });
      }
    }
  }, [activationSSE.events]);

  useEffect(() => {
    if (activationSSE.error) {
      dispatch({ type: "ACTIVATION_ERROR", error: activationSSE.error });
    }
  }, [activationSSE.error]);

  const runActivationTest = useCallback((promptsText: string) => {
    const lines = promptsText.trim().split("\n").filter(Boolean);
    const prompts = lines.map((line) => {
      if (line.startsWith("!")) {
        return { prompt: line.slice(1).trim(), expected: "should_not_activate" as const };
      }
      if (line.startsWith("+")) {
        return { prompt: line.slice(1).trim(), expected: "should_activate" as const };
      }
      return { prompt: line.trim(), expected: "auto" as const };
    });
    dispatch({ type: "ACTIVATION_START" });
    activationSSE.start(`/api/skills/${plugin}/${skill}/activation-test`, { prompts });
  }, [plugin, skill, activationSSE]);

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
    runActivationTest,
    submitAiEdit,
    cancelAiEdit,
    applyAiEdit,
    discardAiEdit,
    toggleEvalChange,
    selectAllEvalChanges,
    deselectAllEvalChanges,
    retryEvalsSave,
  }), [state, saveContent, saveEvals, runCase, runAll, cancelCase, cancelAll, improveForCase, applyImproveAndRerun, refreshSkillContent, generateEvals, runActivationTest, submitAiEdit, cancelAiEdit, applyAiEdit, discardAiEdit, toggleEvalChange, selectAllEvalChanges, deselectAllEvalChanges, retryEvalsSave]);

  return (
    <WorkspaceCtx.Provider value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
