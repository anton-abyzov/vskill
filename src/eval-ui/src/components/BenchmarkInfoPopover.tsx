import { useState, useCallback, useEffect } from "react";
import type { PanelId } from "../pages/workspace/workspaceTypes";

// ---------------------------------------------------------------------------
// T-005 (0707): BenchmarkInfoPopover — tiny ℹ affordance that opens a
// methodology explainer with inline tab-navigation links to the Tests and
// Run panels.
//
// Uses state + an outside-click / Escape handler to dismiss. No portal, no
// new CSS libraries.
// ---------------------------------------------------------------------------

export const BENCHMARK_EXPLANATION =
  "Benchmarks are the aggregated score of this skill's evals (evals.yaml) run against its tests (tests/). Each test case produces a verdict; the benchmark is the mean pass rate.";

export interface BenchmarkInfoPopoverProps {
  /** Called when the user clicks the inline Tests / Run link. */
  onNavigate?: (panel: PanelId) => void;
  /** Optional open-state override for controlled usage (storybook/tests). */
  open?: boolean;
  /** Optional test id. */
  "data-testid"?: string;
}

export function BenchmarkInfoPopover(props: BenchmarkInfoPopoverProps) {
  const { onNavigate } = props;
  const [open, setOpen] = useState(props.open ?? false);

  const close = useCallback(() => setOpen(false), []);

  // Escape key dismisses the popover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const onNavInternal = useCallback(
    (panel: PanelId) => {
      onNavigate?.(panel);
      setOpen(false);
    },
    [onNavigate],
  );

  return (
    <span
      data-testid={props["data-testid"] ?? "benchmark-info"}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      <button
        type="button"
        data-testid="benchmark-info-trigger"
        aria-label="About benchmarks"
        aria-expanded={open ? true : false}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 18,
          height: 18,
          padding: 0,
          border: "1px solid var(--border-default, var(--border))",
          borderRadius: 999,
          background: "transparent",
          color: "var(--text-secondary)",
          fontSize: 11,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
          lineHeight: 1,
        }}
      >
        ℹ
      </button>
      {open && (
        <div
          role="dialog"
          data-testid="benchmark-info-popover"
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 6,
            zIndex: 20,
            width: 280,
            padding: "10px 12px",
            background: "var(--bg-surface, var(--surface-1))",
            border: "1px solid var(--border-default, var(--border))",
            borderRadius: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--text-primary)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          <p style={{ margin: "0 0 8px", lineHeight: 1.45 }}>{BENCHMARK_EXPLANATION}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="benchmark-info-link-tests"
              onClick={() => onNavInternal("tests")}
              style={inlineLinkStyle}
            >
              Tests →
            </button>
            <button
              type="button"
              data-testid="benchmark-info-link-run"
              onClick={() => onNavInternal("run")}
              style={inlineLinkStyle}
            >
              Run →
            </button>
            <button
              type="button"
              data-testid="benchmark-info-close"
              onClick={close}
              style={{ ...inlineLinkStyle, marginLeft: "auto", color: "var(--text-secondary)" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

const inlineLinkStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--text-accent, var(--text-primary))",
  cursor: "pointer",
  textDecoration: "underline",
};

export default BenchmarkInfoPopover;
