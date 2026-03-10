import { useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { ProgressLog } from "../../components/ProgressLog";
import { GroupedBarChart } from "../../components/GroupedBarChart";
import type { RunMode, RunScope, InlineResult } from "./workspaceTypes";

export function RunPanel() {
  const { state, runBenchmark, cancelRun } = useWorkspace();
  const { evals, isRunning, runMode, runScope, latestBenchmark, inlineResults, selectedCaseId } = state;
  const [scopeMode, setScopeMode] = useState<"all" | "selected">("all");

  const cases = evals?.evals ?? [];
  const hasSelection = selectedCaseId != null;

  const handleRun = (mode: RunMode) => {
    const scope: RunScope = scopeMode === "selected" && hasSelection
      ? { caseId: selectedCaseId! }
      : "all";
    runBenchmark(mode, scope);
  };

  // Progress tracking
  const completedCases = cases.filter((c) => {
    const r = inlineResults.get(c.id);
    return r && r.status != null;
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

          {/* Scope selector */}
          <div className="flex items-center gap-1">
            {(["all", "selected"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScopeMode(s)}
                disabled={s === "selected" && !hasSelection}
                className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-all duration-150"
                style={{
                  background: scopeMode === s ? "var(--accent-muted)" : "transparent",
                  color: scopeMode === s ? "var(--accent)" : "var(--text-tertiary)",
                  opacity: s === "selected" && !hasSelection ? 0.4 : 1,
                }}
              >
                {s === "all" ? "All Cases" : "Selected Case"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRunning ? (
            <button onClick={cancelRun} className="btn text-[12px]" style={{ background: "var(--red-muted)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: 4 }}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              Cancel
            </button>
          ) : (
            <>
              <button onClick={() => handleRun("benchmark")} disabled={cases.length === 0} className="btn btn-primary text-[12px]">
                Run Benchmark
              </button>
              <button onClick={() => handleRun("baseline")} disabled={cases.length === 0} className="btn btn-secondary text-[12px]">
                Run Baseline
              </button>
              <button onClick={() => handleRun("comparison")} disabled={cases.length === 0} className="btn btn-purple text-[12px]">
                A/B Compare
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress */}
      {isRunning && cases.length > 0 && (
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
          return <RunCaseCard key={c.id} name={c.name} evalId={c.id} result={r} isRunning={isRunning} onRun={(id) => runBenchmark("benchmark", { caseId: id })} onCompare={(id) => runBenchmark("comparison", { caseId: id })} />;
        })}
      </div>

      {/* Summary on completion */}
      {!isRunning && latestBenchmark && latestBenchmark.cases.length > 0 && (
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
// Run case card
// ---------------------------------------------------------------------------

function RunCaseCard({ name, evalId, result, isRunning, onRun, onCompare }: {
  name: string; evalId: number; result?: InlineResult; isRunning: boolean;
  onRun: (evalId: number) => void; onCompare: (evalId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDone = result && result.status != null;
  const isActive = isRunning && !isDone;

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
          {isActive && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />}
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            #{evalId} {name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isRunning && (
            <>
              <button onClick={() => onRun(evalId)} className="btn btn-primary text-[10px] px-2 py-1">Run</button>
              <button onClick={() => onCompare(evalId)} className="btn btn-purple text-[10px] px-2 py-1">A/B</button>
            </>
          )}
          {isDone && (
            <span
              className="pill text-[10px]"
              style={{
                background: result.status === "pass" ? "var(--green-muted)" : "var(--red-muted)",
                color: result.status === "pass" ? "var(--green)" : "var(--red)",
              }}
            >
              {result.passRate != null ? `${Math.round(result.passRate * 100)}%` : result.status}
            </span>
          )}
          {!isDone && !isActive && isRunning && (
            <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>queued</span>
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
