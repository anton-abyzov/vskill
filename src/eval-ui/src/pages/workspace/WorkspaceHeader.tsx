import { Link } from "react-router-dom";
import type { WorkspaceState } from "./workspaceTypes";

interface Props {
  state: WorkspaceState;
}

export function WorkspaceHeader({ state }: Props) {
  const { plugin, skill, evals, latestBenchmark, isDirty, caseRunStates, regressions, iterationCount, inlineResults } = state;
  const isRunning = Array.from(caseRunStates.values()).some((s) => s.status === "running" || s.status === "queued");

  // Compute overall pass rate from latest benchmark
  // If benchmark exists but no inline results match current evals, it's stale — show "--"
  const evalIds = new Set(evals?.evals.map((e) => e.id) ?? []);
  const hasMatchingResults = evalIds.size > 0 && Array.from(evalIds).some((id) => inlineResults.has(id));
  const passRate = hasMatchingResults ? latestBenchmark?.overall_pass_rate : undefined;
  const totalAssertions = evals?.evals.reduce((sum, e) => sum + e.assertions.length, 0) ?? 0;
  const totalCases = evals?.evals.length ?? 0;

  const passColor = passRate != null
    ? passRate >= 80 ? "var(--green)" : passRate >= 50 ? "var(--yellow)" : "var(--red)"
    : "var(--text-tertiary)";

  const passBackground = passRate != null
    ? passRate >= 80 ? "var(--green-muted)" : passRate >= 50 ? "var(--yellow-muted)" : "var(--red-muted)"
    : "var(--surface-3)";

  return (
    <div
      className="flex items-center justify-between px-4 py-2.5"
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <Link
          to="/"
          className="transition-colors duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          Skills
        </Link>
        <Chevron />
        <span style={{ color: "var(--text-tertiary)" }}>{plugin}</span>
        <Chevron />
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{skill}</span>

        {isDirty && (
          <span
            className="ml-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: "var(--yellow-muted)", color: "var(--yellow)" }}
          >
            unsaved
          </span>
        )}

        {isRunning && (
          <span className="ml-2 flex items-center gap-1.5 text-[11px]" style={{ color: "var(--accent)" }}>
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
            Running...
          </span>
        )}
      </div>

      {/* Right: Stats pills */}
      <div className="flex items-center gap-2">
        {/* Regression alert */}
        {regressions.length > 0 && (
          <span
            className="pill"
            style={{ background: "var(--red-muted)", color: "var(--red)" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {regressions.length} regression{regressions.length > 1 ? "s" : ""}
          </span>
        )}

        {/* Iteration counter */}
        {iterationCount > 0 && (
          <span className="pill" style={{ background: "var(--purple-muted)", color: "var(--purple)" }}>
            Iter {iterationCount}
          </span>
        )}

        {/* Pass rate */}
        <span className="pill" style={{ background: passBackground, color: passColor }}>
          {passRate != null ? `${Math.round(passRate * 100)}%` : "--"}
        </span>

        {/* Counts */}
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {totalCases} case{totalCases !== 1 ? "s" : ""} / {totalAssertions} assert{totalAssertions !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
