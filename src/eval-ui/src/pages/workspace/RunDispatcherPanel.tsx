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
// ---------------------------------------------------------------------------

import { RunPanel } from "./RunPanel";
import { ActivationPanel } from "./ActivationPanel";

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
  if (mode === "activation") return <ActivationPanel />;
  // benchmark + ab both render RunPanel — A/B comparison UI already lives
  // inside RunPanel ("Run A/B Test" CTA). The mode bit is preserved for the
  // URL contract and future inline mode-aware affordances inside RunPanel.
  return <RunPanel />;
}
