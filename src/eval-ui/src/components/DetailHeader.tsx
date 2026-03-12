import type { WorkspaceState } from "../pages/workspace/workspaceTypes";

interface Props {
  state: WorkspaceState;
  isReadOnly?: boolean;
}

export function DetailHeader({ state, isReadOnly }: Props) {
  const { plugin, skill, evals, latestBenchmark, isDirty, caseRunStates, regressions, iterationCount } = state;
  const isRunning = Array.from(caseRunStates.values()).some((s) => s.status === "running" || s.status === "queued");

  const passRate = latestBenchmark?.overall_pass_rate;
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
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)", flexShrink: 0 }}
    >
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px]">
        <span style={{ color: "var(--text-tertiary)" }}>{plugin}</span>
        <Chevron />
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>{skill}</span>

        {isReadOnly && (
          <span
            className="ml-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            installed
          </span>
        )}
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
        {regressions.length > 0 && (
          <span className="pill" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {regressions.length} regression{regressions.length > 1 ? "s" : ""}
          </span>
        )}

        {iterationCount > 0 && (
          <span className="pill" style={{ background: "var(--purple-muted)", color: "var(--purple)" }}>
            Iter {iterationCount}
          </span>
        )}

        <span className="pill" style={{ background: passBackground, color: passColor }}>
          {passRate != null ? `${Math.round(passRate * 100)}%` : "--"}
        </span>

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
