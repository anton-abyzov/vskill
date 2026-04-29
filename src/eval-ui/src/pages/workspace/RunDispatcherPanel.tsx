// ---------------------------------------------------------------------------
// 0792 T-010: RunDispatcherPanel — thin wrapper for the new "Run" tab.
//
// The previous IA had three top-level tabs (Tests / Run / Trigger) that all
// dispatched evaluation runs. The new IA collapses execution into a single
// Run tab with three modes:
//
//   - benchmark  → existing RunPanel (skill-vs-baseline benchmark + A/B)
//   - activation → existing ActivationPanel (Trigger surface)
//   - ab         → existing RunPanel (A/B comparison flow already lives there)
//
// This wrapper only owns the visible mode + dispatches to the existing
// content components. No panel internals change — per plan.md risk mitigation
// the underlying RunPanel/ActivationPanel render exactly the same content
// they did before.
//
// 0800 / AC-US1-04: when the URL carries `?autorun=1` and the active mode is
// "benchmark", dispatch a Run All against the benchmark panel exactly once
// after eval cases are loaded. The autorun flag is stripped from the URL
// after dispatch so a refresh doesn't re-fire. Idempotency is guarded with
// a useRef — survives React StrictMode's intentional double-mount in dev.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { RunPanel } from "./RunPanel";
import { ActivationPanel } from "./ActivationPanel";
import { useWorkspace } from "./WorkspaceContext";

export type RunDispatcherMode = "benchmark" | "activation" | "ab";

export const RUN_MODES: ReadonlyArray<{ id: RunDispatcherMode; label: string }> = [
  { id: "benchmark", label: "Benchmark" },
  { id: "activation", label: "Activation" },
  { id: "ab", label: "A/B" },
];

export function isValidRunMode(value: unknown): value is RunDispatcherMode {
  return value === "benchmark" || value === "activation" || value === "ab";
}

interface Props {
  /** Current mode — provided by RightPanel via the `?mode=` URL param. */
  mode: RunDispatcherMode;
}

export function RunDispatcherPanel({ mode }: Props) {
  const { state, runAll } = useWorkspace();
  const autorunRef = useRef(false);
  const cases = state.evals?.evals ?? [];
  const casesCount = cases.length;
  const evalsExist = state.evals != null;

  useEffect(() => {
    if (mode !== "benchmark") return;
    if (typeof window === "undefined") return;
    if (autorunRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("autorun") !== "1") return;
    if (!evalsExist || casesCount === 0) return;

    autorunRef.current = true;
    runAll("benchmark");

    // Strip the autorun flag so a page refresh doesn't re-fire. Preserve
    // every other query param (tab, mode, etc.) verbatim.
    params.delete("autorun");
    const qs = params.toString();
    const url = `${window.location.pathname}${qs ? "?" + qs : ""}${window.location.hash}`;
    window.history.replaceState(null, "", url);
  }, [mode, evalsExist, casesCount, runAll]);

  if (mode === "activation") return <ActivationPanel />;
  // benchmark + ab both render RunPanel — A/B comparison UI already lives
  // inside RunPanel ("Run A/B Test" CTA). The mode bit is preserved for the
  // URL contract and future inline mode-aware affordances inside RunPanel.
  return <RunPanel />;
}
