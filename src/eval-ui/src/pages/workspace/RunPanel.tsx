import { useState, useMemo } from "react";
import { useWorkspace } from "./WorkspaceContext";
import type { RunMode, InlineResult, CaseRunStatus } from "./workspaceTypes";

export function RunPanel() {
  const { state, runCase, runAll, cancelCase, cancelAll } = useWorkspace();
  const { evals, caseRunStates, bulkRunActive, runMode, latestBenchmark, inlineResults } = state;

  const cases = evals?.evals ?? [];

  const isAnyRunning = useMemo(() => {
    for (const s of caseRunStates.values()) {
      if (s.status === "running" || s.status === "queued") return true;
    }
    return false;
  }, [caseRunStates]);

  // Progress tracking
  const completedCases = cases.filter((c) => {
    const s = caseRunStates.get(c.id);
    return s && (s.status === "complete" || s.status === "error" || s.status === "cancelled");
  }).length;

  const runningCases = cases.filter((c) => {
    const s = caseRunStates.get(c.id);
    return s && (s.status === "running" || s.status === "queued");
  }).length;

  return (
    <div className="p-5">
      {/* Controls */}
      <div
        className="rounded-xl p-4 mb-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Benchmark</span>
          {isAnyRunning && (
            <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
              {runningCases} running
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAnyRunning && (
            <button onClick={cancelAll} className="btn text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Cancel All
            </button>
          )}
          <button onClick={() => runAll("comparison")} disabled={cases.length === 0 || isAnyRunning} className="btn btn-primary text-[12px]">
            Compare All
          </button>
          <button onClick={() => runAll("benchmark")} disabled={cases.length === 0 || isAnyRunning} className="btn btn-secondary text-[12px]">
            Skill Only
          </button>
          <button onClick={() => runAll("baseline")} disabled={cases.length === 0 || isAnyRunning} className="btn btn-secondary text-[12px]">
            Baseline Only
          </button>
        </div>
      </div>

      {/* Progress */}
      {isAnyRunning && cases.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
              Progress: {completedCases}/{cases.length} cases
            </span>
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              {Math.round((completedCases / cases.length) * 100)}%
            </span>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(completedCases / cases.length) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </div>
        </div>
      )}

      {/* Results cards */}
      <div className="space-y-3 stagger-children">
        {cases.map((c) => {
          const r = inlineResults.get(c.id);
          const caseStatus = caseRunStates.get(c.id)?.status ?? "idle";
          return (
            <RunCaseCard
              key={c.id}
              name={c.name}
              evalId={c.id}
              result={r}
              caseStatus={caseStatus}
              runMode={runMode}
              onRun={(id) => runCase(id, "benchmark")}
              onBaseline={(id) => runCase(id, "baseline")}
              onCompare={(id) => runCase(id, "comparison")}
              onCancel={(id) => cancelCase(id)}
            />
          );
        })}
      </div>

      {/* Summary on completion */}
      {!isAnyRunning && latestBenchmark && latestBenchmark.cases.length > 0 && (
        <div className="mt-5">
          <div
            className="rounded-xl p-4 mb-4"
            style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Overall Pass Rate
              </span>
              <span
                className="text-[20px] font-bold"
                style={{
                  color: (latestBenchmark.overall_pass_rate ?? 0) >= 0.8 ? "var(--green)"
                    : (latestBenchmark.overall_pass_rate ?? 0) >= 0.5 ? "var(--yellow)"
                    : "var(--red)",
                }}
              >
                {latestBenchmark.overall_pass_rate != null ? `${Math.round(latestBenchmark.overall_pass_rate * 100)}%` : "--"}
              </span>
            </div>
            {latestBenchmark.totalDurationMs != null && (
              <div className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>
                Total: {(latestBenchmark.totalDurationMs / 1000).toFixed(1)}s
                {latestBenchmark.model && ` | Model: ${latestBenchmark.model}`}
              </div>
            )}
          </div>

          {/* Comparison scores */}
          {latestBenchmark.comparison && (
            <div
              className="rounded-xl p-4"
              style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-tertiary)" }}>
                Skill vs Baseline
              </div>
              <div className="grid grid-cols-2 gap-4">
                <ScoreBar label="Skill" value={latestBenchmark.comparison.skillPassRate} color="var(--accent)" />
                <ScoreBar label="Baseline" value={latestBenchmark.comparison.baselinePassRate} color="var(--text-tertiary)" />
              </div>
              <div className="mt-3 text-[12px] font-medium" style={{
                color: latestBenchmark.comparison.delta > 0 ? "var(--green)" : latestBenchmark.comparison.delta < 0 ? "var(--red)" : "var(--text-tertiary)",
              }}>
                Delta: {latestBenchmark.comparison.delta > 0 ? "+" : ""}{(latestBenchmark.comparison.delta * 100).toFixed(1)}%
                {latestBenchmark.verdict && ` | ${latestBenchmark.verdict}`}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run case card — independent per-case controls
// ---------------------------------------------------------------------------

const MODE_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  benchmark: { label: "Skill", bg: "var(--accent-muted)", color: "var(--accent)" },
  baseline: { label: "Baseline", bg: "var(--surface-3)", color: "var(--text-tertiary)" },
  comparison: { label: "Compare", bg: "rgba(168,85,247,0.12)", color: "rgb(168,85,247)" },
};

function RunCaseCard({ name, evalId, result, caseStatus, runMode, onRun, onBaseline, onCompare, onCancel }: {
  name: string;
  evalId: number;
  result?: InlineResult;
  caseStatus: CaseRunStatus;
  runMode: RunMode | null;
  onRun: (evalId: number) => void;
  onBaseline: (evalId: number) => void;
  onCompare: (evalId: number) => void;
  onCancel: (evalId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = caseStatus === "running" || caseStatus === "queued";
  const isDone = caseStatus === "complete" || caseStatus === "error";

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-200"
      style={{
        background: "var(--surface-1)",
        border: isActive ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
        boxShadow: isActive ? "0 0 12px rgba(99, 131, 255, 0.15)" : "none",
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {caseStatus === "running" && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />}
          {caseStatus === "queued" && (
            <span className="text-[10px] font-medium" style={{ color: "var(--text-tertiary)" }}>queued</span>
          )}
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            #{evalId} {name}
          </span>
          {runMode && (isActive || isDone) && (() => {
            const badge = MODE_BADGE[runMode];
            return badge ? (
              <span className="pill text-[9px] font-semibold" style={{ background: badge.bg, color: badge.color, padding: "1px 6px" }}>
                {badge.label}
              </span>
            ) : null;
          })()}
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <button
              onClick={() => onCancel(evalId)}
              className="btn text-[10px] px-2 py-1"
              style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              Cancel
            </button>
          ) : (
            <>
              <button onClick={() => onCompare(evalId)} className="btn btn-primary text-[10px] px-2 py-1">Compare</button>
              <button onClick={() => onRun(evalId)} className="btn btn-secondary text-[10px] px-2 py-1">Skill</button>
              <button onClick={() => onBaseline(evalId)} className="btn btn-secondary text-[10px] px-2 py-1">Base</button>
            </>
          )}
          {result && result.status != null && (
            <span
              className="pill text-[10px]"
              style={{
                background: result.status === "pass" ? "var(--green-muted)" : result.status === "error" ? "var(--red-muted)" : "var(--red-muted)",
                color: result.status === "pass" ? "var(--green)" : "var(--red)",
              }}
            >
              {result.passRate != null ? `${Math.round(result.passRate * 100)}%` : result.status}
            </span>
          )}
          {caseStatus === "cancelled" && (
            <span className="pill text-[10px]" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
              cancelled
            </span>
          )}
        </div>
      </div>

      {/* Assertions */}
      {result && result.assertions.length > 0 && (
        <div className="px-4 pb-3">
          <div className="space-y-1">
            {result.assertions.map((a) => (
              <div key={a.assertion_id} className="flex items-center gap-2 text-[11px]">
                <span style={{ color: a.pass ? "var(--green)" : "var(--red)" }}>
                  {a.pass ? "PASS" : "FAIL"}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{a.text}</span>
              </div>
            ))}
          </div>

          {result.output && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] mt-2 transition-colors duration-150"
              style={{ color: "var(--text-tertiary)" }}
            >
              {expanded ? "Hide output" : "Show output"}
            </button>
          )}
          {expanded && result.output && (
            <pre
              className="text-[11px] mt-2 p-3 rounded-lg overflow-auto"
              style={{
                background: "var(--surface-0)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
                maxHeight: 200,
                fontFamily: "var(--font-mono, ui-monospace, monospace)",
                whiteSpace: "pre-wrap",
              }}
            >
              {result.output}
            </pre>
          )}
        </div>
      )}

      {/* Error message */}
      {result && result.errorMessage && (
        <div className="px-4 pb-3">
          <div className="text-[11px] p-2 rounded-lg" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
            {result.errorMessage}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
        <span className="text-[12px] font-semibold" style={{ color }}>{Math.round(value * 100)}%</span>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 6, background: "var(--surface-3)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value * 100}%`, background: color }} />
      </div>
    </div>
  );
}
