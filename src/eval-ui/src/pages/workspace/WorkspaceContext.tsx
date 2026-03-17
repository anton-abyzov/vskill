import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useRef } from "react";
import { api } from "../../api";
import { useConfig } from "../../ConfigContext";
import { useMultiSSE, useSSE } from "../../sse";
import type { SSEEvent } from "../../sse";
import type { ActivationResult, ActivationSummary } from "../../types";
import type { EvalsFile, BenchmarkResult, EvalChange } from "../../types";
import type { ClassifiedError } from "../../components/ErrorCard";
import type { WorkspaceContextValue, PanelId, RunMode, InlineResult, AssertionResultInline, ActivationHistoryRun } from "./workspaceTypes";
import { workspaceReducer, initialWorkspaceState } from "./workspaceReducer";

// ---------------------------------------------------------------------------
// Pure accumulator mutation — extracted for testability
// ---------------------------------------------------------------------------
export function applySSEToAccumulator(r: InlineResult, evt: SSEEvent): void {
  const data = evt.data as Record<string, unknown>;

  if (evt.event === "output_ready") {
    r.output = data.output as string;
    if (data.durationMs != null) r.durationMs = data.durationMs as number;
    if (data.tokens != null) r.tokens = data.tokens as number | null;
  }

  if (evt.event === "outputs_ready") {
    r.output = data.skillOutput as string;
    if (data.skillDurationMs != null) r.durationMs = data.skillDurationMs as number;
    if (data.skillTokens != null) r.tokens = data.skillTokens as number | null;
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
    r.classifiedError = (data.classified_error as InlineResult["classifiedError"]) || undefined;
  }
}

const WorkspaceCtx = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

interface Props {
  plugin: string;
  skill: string;
  origin: "source" | "installed";
  children: React.ReactNode;
}

export function WorkspaceProvider({ plugin, skill, origin, children }: Props) {
  const isReadOnly = origin === "installed";
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
    // Get or create mutable accumulator for this case
    let r = inlineAccRef.current.get(caseId);
    if (!r) {
      r = { assertions: [] };
      inlineAccRef.current.set(caseId, r);
    }

    applySSEToAccumulator(r, evt);

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

        // For evals: 404 = no file (silent), 400 = invalid file (show error)
        let evalsValue: EvalsFile | null = null;
        let evalsError: string | null = null;
        if (evals.status === "fulfilled") {
          evalsValue = evals.value;
        } else {
          const err = evals.reason as Error & { status?: number };
          if (err?.status !== 404) {
            evalsError = err?.message ?? "Failed to load test cases";
          }
        }

        dispatch({
          type: "INIT_DATA",
          skillContent: detail.status === "fulfilled" ? detail.value.skillContent : "",
          evals: evalsValue,
          evalsError,
          benchmark: benchmark.status === "fulfilled" ? benchmark.value : null,
        });
      } catch (e) {
        if (!cancelled) dispatch({ type: "SET_ERROR", error: (e as Error).message });
      }
    }

    load();
    // Also fetch activation history on mount
    fetchActivationHistory();
    return () => { cancelled = true; };
  }, [plugin, skill, fetchActivationHistory]);

  // ---------------------------------------------------------------------------
  // Async actions
  // ---------------------------------------------------------------------------
  const saveContent = useCallback(async () => {
    if (isReadOnly) return;
    try {
      await api.applyImprovement(plugin, skill, state.skillContent);
      dispatch({ type: "CONTENT_SAVED" });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [isReadOnly, plugin, skill, state.skillContent]);

  const saveEvals = useCallback(async (updated: EvalsFile) => {
    if (isReadOnly) return;
    try {
      const saved = await api.saveEvals(plugin, skill, updated);
      dispatch({ type: "SET_EVALS", evals: saved });
    } catch (e) {
      dispatch({ type: "SET_ERROR", error: (e as Error).message });
    }
  }, [isReadOnly, plugin, skill]);

  // -- Per-case run --
  const runCase = useCallback((caseId: number, mode: RunMode = "benchmark") => {
    if (isReadOnly) return;
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
  }, [isReadOnly, plugin, skill, state.caseRunStates, sseStartCase]);

  // -- Run all cases in parallel --
  const runAll = useCallback((mode: RunMode = "benchmark") => {
    if (isReadOnly) return;
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
  }, [isReadOnly, plugin, skill, state.evals, sseStartCase]);

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
  const lastAiEditIdxRef = useRef(0);

  // Process AI Edit SSE events (cursor pattern to avoid duplicate dispatch)
  useEffect(() => {
    const events = aiEditSSE.events;
    for (let i = lastAiEditIdxRef.current; i < events.length; i++) {
      const evt = events[i];
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
    lastAiEditIdxRef.current = events.length;
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
    if (isReadOnly) return;
    lastAiEditIdxRef.current = 0;
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
  }, [isReadOnly, plugin, skill, state.skillContent, state.evals, aiEditSSE]);

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
      dispatch({ type: "SET_ERROR", error: null });
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
  const lastGenEvalsIdxRef = useRef(0);

  // Process Generate Evals SSE events (cursor pattern to avoid duplicate dispatch)
  useEffect(() => {
    const events = genEvalsSSE.events;
    for (let i = lastGenEvalsIdxRef.current; i < events.length; i++) {
      const evt = events[i];
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
        const evalsFile = data as unknown as EvalsFile;
        api.saveEvals(plugin, skill, evalsFile)
          .then((saved) => dispatch({ type: "GENERATE_EVALS_DONE", evals: saved }))
          .catch((e) => dispatch({ type: "SET_ERROR", error: (e as Error).message }));
      }
      if (evt.event === "error") {
        dispatch({ type: "GENERATE_EVALS_ERROR", classified: data as unknown as ClassifiedError });
      }
    }
    lastGenEvalsIdxRef.current = events.length;
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
    if (isReadOnly) return;
    lastGenEvalsIdxRef.current = 0;
    dispatch({ type: "GENERATE_EVALS_START" });
    genEvalsSSE.start(`/api/skills/${plugin}/${skill}/generate-evals?sse`);
  }, [isReadOnly, plugin, skill, genEvalsSSE]);

  // ---------------------------------------------------------------------------
  // Activation test SSE
  // ---------------------------------------------------------------------------
  const activationSSE = useSSE();
  const lastActivationIdxRef = useRef(0);
  const { config } = useConfig();

  // Cleanup activation SSE on unmount
  useEffect(() => {
    return () => { activationSSE.stop(); };
  }, [activationSSE.stop]);

  // Process activation SSE events (cursor pattern to avoid duplicate dispatch)
  useEffect(() => {
    const events = activationSSE.events;
    for (let i = lastActivationIdxRef.current; i < events.length; i++) {
      const evt = events[i];
      if (evt.event === "prompt_result") {
        dispatch({ type: "ACTIVATION_RESULT", result: evt.data as ActivationResult });
      }
      if (evt.event === "done") {
        if (activationTimeoutRef.current) {
          clearTimeout(activationTimeoutRef.current);
          activationTimeoutRef.current = null;
        }
        const summary = evt.data as ActivationSummary & { description?: string };
        dispatch({ type: "ACTIVATION_DONE", summary });

        // Prepend the completed run to the activation history
        const run: ActivationHistoryRun = {
          id: `run-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: config?.model || "unknown",
          provider: config?.provider || "unknown",
          promptCount: summary.total,
          summary: {
            precision: summary.precision,
            recall: summary.recall,
            reliability: summary.reliability,
            tp: summary.tp,
            tn: summary.tn,
            fp: summary.fp,
            fn: summary.fn,
          },
        };
        dispatch({ type: "ACTIVATION_HISTORY_LOADED", runs: [run, ...(state.activationHistory ?? [])] });
      }
    }
    lastActivationIdxRef.current = events.length;
  }, [activationSSE.events, config, state.activationHistory]);

  useEffect(() => {
    if (activationSSE.error) {
      if (activationTimeoutRef.current) {
        clearTimeout(activationTimeoutRef.current);
        activationTimeoutRef.current = null;
      }
      dispatch({ type: "ACTIVATION_ERROR", error: activationSSE.error });
    }
  }, [activationSSE.error]);

  const activationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelActivation = useCallback(() => {
    if (activationTimeoutRef.current) {
      clearTimeout(activationTimeoutRef.current);
      activationTimeoutRef.current = null;
    }
    activationSSE.stop();
    dispatch({ type: "ACTIVATION_CANCEL", totalPrompts: 0 });
  }, [activationSSE]);

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
    lastActivationIdxRef.current = 0;
    dispatch({ type: "ACTIVATION_START" });
    dispatch({ type: "SET_ACTIVATION_PROMPTS", prompts: promptsText });

    // Forward model config from ConfigContext
    const body: Record<string, unknown> = { prompts };
    if (config?.provider) body.provider = config.provider;
    if (config?.model) body.model = config.model;
    activationSSE.start(`/api/skills/${plugin}/${skill}/activation-test`, body);

    // 120s client-side timeout
    if (activationTimeoutRef.current) clearTimeout(activationTimeoutRef.current);
    activationTimeoutRef.current = setTimeout(() => {
      activationSSE.stop();
      dispatch({ type: "ACTIVATION_TIMEOUT" });
      activationTimeoutRef.current = null;
    }, 120_000);
  }, [plugin, skill, activationSSE, config]);

  // ---------------------------------------------------------------------------
  // AI prompt generation
  // ---------------------------------------------------------------------------
  const generateActivationPrompts = useCallback(async (count = 8) => {
    dispatch({ type: "GENERATE_PROMPTS_START" });
    try {
      const reqBody: Record<string, unknown> = { count };
      if (config?.provider) reqBody.provider = config.provider;
      if (config?.model) reqBody.model = config.model;

      const res = await fetch(`/api/skills/${plugin}/${skill}/activation-prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }

      // Backend returns SSE stream — parse events to extract prompts from the done event
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let finalPrompts: Array<{ prompt: string; expected: string }> = [];

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "done") {
                finalPrompts = data.prompts || [];
              }
              if (currentEvent === "error") {
                throw new Error(data.message || data.description || "Generation failed");
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Generation failed") {
                // skip malformed JSON
              } else {
                throw e;
              }
            }
            currentEvent = "";
          }
        }
      }

      const text = finalPrompts.map((p) => {
        const prefix = p.expected === "should_activate" ? "+" : "!";
        return `${prefix}${p.prompt}`;
      }).join("\n");

      dispatch({ type: "SET_ACTIVATION_PROMPTS", prompts: text });
      dispatch({ type: "GENERATE_PROMPTS_DONE" });
    } catch (e) {
      dispatch({ type: "GENERATE_PROMPTS_ERROR", error: (e as Error).message });
    }
  }, [plugin, skill, config]);

  // ---------------------------------------------------------------------------
  // Activation history
  // ---------------------------------------------------------------------------
  const fetchActivationHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills/${plugin}/${skill}/activation-history`);
      if (!res.ok) {
        if (res.status === 404) {
          dispatch({ type: "ACTIVATION_HISTORY_LOADED", runs: [] });
          return;
        }
        return;
      }
      const data = await res.json();
      dispatch({ type: "ACTIVATION_HISTORY_LOADED", runs: data.runs || [] });
    } catch {
      // Non-blocking — history is optional
    }
  }, [plugin, skill]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    state,
    dispatch,
    isReadOnly,
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
    cancelActivation,
    generateActivationPrompts,
    fetchActivationHistory,
    submitAiEdit,
    cancelAiEdit,
    applyAiEdit,
    discardAiEdit,
    toggleEvalChange,
    selectAllEvalChanges,
    deselectAllEvalChanges,
    retryEvalsSave,
  }), [state, isReadOnly, saveContent, saveEvals, runCase, runAll, cancelCase, cancelAll, improveForCase, applyImproveAndRerun, refreshSkillContent, generateEvals, runActivationTest, cancelActivation, generateActivationPrompts, fetchActivationHistory, submitAiEdit, cancelAiEdit, applyAiEdit, discardAiEdit, toggleEvalChange, selectAllEvalChanges, deselectAllEvalChanges, retryEvalsSave]);

  return (
    <WorkspaceCtx.Provider value={value}>
      {children}
    </WorkspaceCtx.Provider>
  );
}
