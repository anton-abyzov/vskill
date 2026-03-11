import { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import { TrendChart } from "../../components/TrendChart";
import { StatsPanel } from "../../components/StatsPanel";
import { HistoryPerEval } from "../../components/HistoryPerEval";
import { computeDiff } from "../../utils/diff";
import type { DiffLine } from "../../utils/diff";
import type { HistorySummary, HistoryCompareResult, BenchmarkResult } from "../../types";

type Tab = "timeline" | "per-eval" | "statistics";

export function HistoryPanel() {
  const { state, dispatch } = useWorkspace();
  const { plugin, skill } = state;
  const [tab, setTab] = useState<Tab>("timeline");
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterModel, setFilterModel] = useState("");
  const [filterType, setFilterType] = useState<"" | "benchmark" | "comparison" | "baseline" | "model-compare" | "improve" | "instruct" | "ai-generate" | "eval-generate">("");

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<string[]>([]);
  const [compareResult, setCompareResult] = useState<HistoryCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // Detail view
  const [detailRun, setDetailRun] = useState<BenchmarkResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getHistory(plugin, skill, {
      model: filterModel || undefined,
      type: (filterType || undefined) as HistorySummary["type"] | undefined,
    }).then((h) => {
      setHistory(h);

      // Detect regressions from last 2 runs
      if (h.length >= 2) {
        api.compareRuns(plugin, skill, h[0].timestamp, h[1].timestamp)
          .then((cr) => {
            const regressions = cr.regressions.filter((r) => r.change === "regression");
            dispatch({ type: "SET_REGRESSIONS", regressions });
          })
          .catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [plugin, skill, filterModel, filterType]);

  const handleRunClick = useCallback(async (timestamp: string) => {
    if (compareMode) {
      setSelectedRuns((prev) => {
        if (prev.includes(timestamp)) return prev.filter((t) => t !== timestamp);
        if (prev.length >= 2) return [prev[1], timestamp];
        return [...prev, timestamp];
      });
      return;
    }
    setDetailLoading(true);
    try {
      const entry = await api.getHistoryEntry(plugin, skill, timestamp);
      setDetailRun(entry);
    } catch {} finally {
      setDetailLoading(false);
    }
  }, [plugin, skill, compareMode]);

  const handleCompare = useCallback(async () => {
    if (selectedRuns.length !== 2) return;
    setComparing(true);
    try {
      const result = await api.compareRuns(plugin, skill, selectedRuns[0], selectedRuns[1]);
      setCompareResult(result);
    } catch {} finally {
      setComparing(false);
    }
  }, [plugin, skill, selectedRuns]);

  const models = [...new Set(history.map((h) => h.model))];

  if (loading) {
    return (
      <div className="p-5">
        <div className="skeleton h-5 w-32 mb-4" />
        <div className="skeleton h-48 rounded-xl mb-4" />
        <div className="space-y-2">
          <div className="skeleton h-12 rounded-lg" />
          <div className="skeleton h-12 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4">
        {(["timeline", "per-eval", "statistics"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-lg text-[12px] font-medium transition-all duration-150"
            style={{
              background: tab === t ? "var(--accent-muted)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-tertiary)",
            }}
          >
            {t === "timeline" ? "Timeline" : t === "per-eval" ? "Per Eval" : "Statistics"}
          </button>
        ))}
      </div>

      {/* Timeline tab */}
      {tab === "timeline" && (
        <div>
          {/* Trend chart */}
          {history.length > 0 && (
            <div className="mb-5 rounded-xl p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
              <TrendChart entries={history} />
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 mb-3">
            <select
              value={filterModel}
              onChange={(e) => setFilterModel(e.target.value)}
              className="input-field text-[12px]"
              style={{ width: 150 }}
            >
              <option value="">All Models</option>
              {models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className="input-field text-[12px]"
              style={{ width: 150 }}
            >
              <option value="">All Types</option>
              <option value="benchmark">Benchmark</option>
              <option value="comparison">Comparison</option>
              <option value="baseline">Baseline</option>
              <option value="model-compare">Model Compare</option>
              <option value="improve">AI Improve</option>
              <option value="instruct">AI Edit</option>
              <option value="ai-generate">AI Generate</option>
              <option value="eval-generate">Eval Generate</option>
            </select>

            <div className="flex-1" />

            <button
              onClick={() => { setCompareMode(!compareMode); setSelectedRuns([]); setCompareResult(null); }}
              className={`btn text-[12px] ${compareMode ? "btn-primary" : "btn-secondary"}`}
            >
              {compareMode ? "Exit Compare" : "Compare Runs"}
            </button>

            {compareMode && selectedRuns.length === 2 && (
              <button onClick={handleCompare} disabled={comparing} className="btn btn-primary text-[12px]">
                {comparing ? "Comparing..." : "Compare"}
              </button>
            )}
          </div>

          {/* Run list */}
          <div className="space-y-2">
            {history.length === 0 ? (
              <div className="text-center py-8 text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                No benchmark runs yet
              </div>
            ) : (
              history.map((h) => {
                const selected = selectedRuns.includes(h.timestamp);
                return (
                  <button
                    key={h.timestamp}
                    onClick={() => handleRunClick(h.timestamp)}
                    className="w-full text-left rounded-lg px-4 py-3 transition-all duration-150"
                    style={{
                      background: selected ? "var(--accent-muted)" : "var(--surface-1)",
                      border: selected ? "1px solid var(--accent)" : "1px solid var(--border-subtle)",
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = "var(--border-hover)"; }}
                    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {compareMode && (
                          <span
                            className="w-4 h-4 rounded border flex items-center justify-center"
                            style={{
                              borderColor: selected ? "var(--accent)" : "var(--border-default)",
                              background: selected ? "var(--accent)" : "transparent",
                            }}
                          >
                            {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                          </span>
                        )}
                        <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                          {new Date(h.timestamp).toLocaleString()}
                        </span>
                        <span className="pill text-[9px]" style={{
                          background: h.type === "comparison" ? "var(--purple-muted)"
                            : h.type === "baseline" ? "var(--surface-3)"
                            : h.type === "model-compare" ? "rgba(56,189,248,0.15)"
                            : (h.type === "improve" || h.type === "instruct") ? "rgba(168,85,247,0.15)"
                            : h.type === "ai-generate" ? "rgba(34,197,94,0.15)"
                            : h.type === "eval-generate" ? "rgba(251,146,60,0.15)"
                            : "var(--accent-muted)",
                          color: h.type === "comparison" ? "var(--purple)"
                            : h.type === "baseline" ? "var(--text-tertiary)"
                            : h.type === "model-compare" ? "#38bdf8"
                            : (h.type === "improve" || h.type === "instruct") ? "#a855f7"
                            : h.type === "ai-generate" ? "#22c55e"
                            : h.type === "eval-generate" ? "#fb923c"
                            : "var(--accent)",
                        }}>
                          {h.type === "model-compare" ? "model compare" : h.type === "improve" ? "ai improve" : h.type === "instruct" ? "ai edit" : h.type === "ai-generate" ? "ai generate" : h.type === "eval-generate" ? "eval generate" : h.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{h.model}</span>
                        <span
                          className="text-[12px] font-semibold"
                          style={{ color: h.passRate >= 0.8 ? "var(--green)" : h.passRate >= 0.5 ? "var(--yellow)" : "var(--red)" }}
                        >
                          {Math.round(h.passRate * 100)}%
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Compare result */}
          {compareResult && (
            <CompareResultView result={compareResult} />
          )}

          {/* Detail view */}
          {detailRun && !compareMode && (
            <DetailView run={detailRun} onClose={() => setDetailRun(null)} />
          )}
        </div>
      )}

      {/* Per-eval tab */}
      {tab === "per-eval" && (
        <HistoryPerEval plugin={plugin} skill={skill} />
      )}

      {/* Statistics tab */}
      {tab === "statistics" && (
        <StatsPanel plugin={plugin} skill={skill} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare result
// ---------------------------------------------------------------------------

function CompareResultView({ result }: { result: HistoryCompareResult }) {
  const regressions = result.regressions.filter((r) => r.change === "regression");
  const improvements = result.regressions.filter((r) => r.change === "improvement");

  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
      <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
        Comparison: {new Date(result.runA.timestamp).toLocaleDateString()} vs {new Date(result.runB.timestamp).toLocaleDateString()}
      </div>

      {regressions.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--red)" }}>
            Regressions ({regressions.length})
          </div>
          {regressions.map((r) => (
            <div key={`${r.evalId}-${r.assertionId}`} className="text-[12px] py-1" style={{ color: "var(--text-secondary)" }}>
              #{r.evalId} {r.evalName}: <span style={{ color: "var(--red)" }}>{r.assertionId}</span> (was passing, now failing)
            </div>
          ))}
        </div>
      )}

      {improvements.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--green)" }}>
            Improvements ({improvements.length})
          </div>
          {improvements.map((r) => (
            <div key={`${r.evalId}-${r.assertionId}`} className="text-[12px] py-1" style={{ color: "var(--text-secondary)" }}>
              #{r.evalId} {r.evalName}: <span style={{ color: "var(--green)" }}>{r.assertionId}</span> (was failing, now passing)
            </div>
          ))}
        </div>
      )}

      {/* Case diffs table */}
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 mt-3" style={{ color: "var(--text-tertiary)" }}>
        Case Diffs
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--text-tertiary)" }}>Case</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-tertiary)" }}>Run A</th>
              <th className="text-right px-3 py-2 font-medium" style={{ color: "var(--text-tertiary)" }}>Run B</th>
            </tr>
          </thead>
          <tbody>
            {result.caseDiffs.map((d) => (
              <tr key={d.eval_id} style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>#{d.eval_id} {d.eval_name}</td>
                <td className="text-right px-3 py-2" style={{
                  color: d.passRateA != null ? (d.passRateA >= 0.8 ? "var(--green)" : d.passRateA >= 0.5 ? "var(--yellow)" : "var(--red)") : "var(--text-tertiary)",
                }}>
                  {d.passRateA != null ? `${Math.round(d.passRateA * 100)}%` : d.statusA}
                </td>
                <td className="text-right px-3 py-2" style={{
                  color: d.passRateB != null ? (d.passRateB >= 0.8 ? "var(--green)" : d.passRateB >= 0.5 ? "var(--yellow)" : "var(--red)") : "var(--text-tertiary)",
                }}>
                  {d.passRateB != null ? `${Math.round(d.passRateB * 100)}%` : d.statusB}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function DetailView({ run, onClose }: { run: BenchmarkResult; onClose: () => void }) {
  // Improve entries get a diff view
  if ((run.type === "improve" || run.type === "instruct") && run.improve) {
    return <ImproveDiffView run={run} onClose={onClose} />;
  }

  return (
    <div className="mt-4 rounded-xl p-4" style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Run: {new Date(run.timestamp).toLocaleString()}
        </span>
        <button onClick={onClose} className="btn btn-ghost text-[11px]">Close</button>
      </div>
      <div className="text-[11px] mb-3" style={{ color: "var(--text-tertiary)" }}>
        Model: {run.model} | Cases: {run.cases.length} | Pass Rate: {run.overall_pass_rate != null ? `${Math.round(run.overall_pass_rate * 100)}%` : "--"}
      </div>
      <div className="space-y-2">
        {run.cases.map((c) => (
          <div key={c.eval_id} className="rounded-lg px-3 py-2" style={{ background: "var(--surface-2)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>#{c.eval_id} {c.eval_name}</span>
              <span className="text-[11px] font-semibold" style={{
                color: c.status === "pass" ? "var(--green)" : "var(--red)",
              }}>
                {c.pass_rate != null ? `${Math.round(c.pass_rate * 100)}%` : c.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Improve diff view — git-style SKILL.md diff
// ---------------------------------------------------------------------------

function ImproveDiffView({ run, onClose }: { run: BenchmarkResult; onClose: () => void }) {
  const diff = useMemo<DiffLine[]>(
    () => run.improve ? computeDiff(run.improve.original, run.improve.improved) : [],
    [run.improve],
  );

  const stats = useMemo(() => {
    const added = diff.filter((l) => l.type === "added").length;
    const removed = diff.filter((l) => l.type === "removed").length;
    return { added, removed };
  }, [diff]);

  // Line numbers for original and improved
  const numberedLines = useMemo(() => {
    let origLine = 0;
    let newLine = 0;
    return diff.map((line) => {
      if (line.type === "removed") {
        origLine++;
        return { ...line, origNum: origLine, newNum: null };
      } else if (line.type === "added") {
        newLine++;
        return { ...line, origNum: null, newNum: newLine };
      } else {
        origLine++;
        newLine++;
        return { ...line, origNum: origLine, newNum: newLine };
      }
    });
  }, [diff]);

  return (
    <div
      className="mt-4 rounded-xl overflow-hidden animate-fade-in"
      style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(168,85,247,0.15)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              SKILL.md Changes
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
              {new Date(run.timestamp).toLocaleString()} &middot; {run.model}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span style={{ color: "var(--green)" }}>+{stats.added}</span>
            <span style={{ color: "var(--red)" }}>-{stats.removed}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: "var(--text-tertiary)" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* AI Reasoning */}
      {run.improve?.reasoning && (
        <div
          className="mx-4 mt-4 px-4 py-3 rounded-lg text-[12px]"
          style={{
            background: "rgba(168,85,247,0.06)",
            border: "1px solid rgba(168,85,247,0.15)",
            color: "var(--text-secondary)",
          }}
        >
          <span className="font-semibold" style={{ color: "#a855f7" }}>AI Reasoning: </span>
          {run.improve.reasoning}
        </div>
      )}

      {/* Diff body */}
      <div
        className="mx-4 my-4 rounded-lg overflow-hidden"
        style={{ border: "1px solid var(--border-subtle)", maxHeight: 480, overflowY: "auto" }}
      >
        <table className="w-full" style={{ borderCollapse: "collapse", fontFamily: "var(--font-mono, monospace)" }}>
          <tbody>
            {numberedLines.map((line, i) => (
              <tr
                key={i}
                style={{
                  background:
                    line.type === "added" ? "rgba(34,197,94,0.08)" :
                    line.type === "removed" ? "rgba(239,68,68,0.08)" :
                    "transparent",
                }}
              >
                {/* Old line number */}
                <td
                  className="text-right select-none px-2"
                  style={{
                    width: 40,
                    fontSize: 10,
                    color: line.type === "removed" ? "rgba(239,68,68,0.5)" : "var(--text-tertiary)",
                    opacity: line.origNum ? 0.6 : 0.2,
                    borderRight: "1px solid var(--border-subtle)",
                  }}
                >
                  {line.origNum ?? ""}
                </td>
                {/* New line number */}
                <td
                  className="text-right select-none px-2"
                  style={{
                    width: 40,
                    fontSize: 10,
                    color: line.type === "added" ? "rgba(34,197,94,0.5)" : "var(--text-tertiary)",
                    opacity: line.newNum ? 0.6 : 0.2,
                    borderRight: "1px solid var(--border-subtle)",
                  }}
                >
                  {line.newNum ?? ""}
                </td>
                {/* Gutter */}
                <td
                  className="select-none text-center"
                  style={{
                    width: 20,
                    fontSize: 11,
                    fontWeight: 700,
                    color:
                      line.type === "added" ? "var(--green)" :
                      line.type === "removed" ? "var(--red)" :
                      "transparent",
                    borderRight:
                      line.type === "added" ? "2px solid var(--green)" :
                      line.type === "removed" ? "2px solid var(--red)" :
                      "2px solid transparent",
                  }}
                >
                  {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                </td>
                {/* Content */}
                <td
                  className="px-3 py-px whitespace-pre-wrap"
                  style={{
                    fontSize: 11,
                    lineHeight: 1.6,
                    color:
                      line.type === "added" ? "var(--green)" :
                      line.type === "removed" ? "var(--red)" :
                      "var(--text-secondary)",
                  }}
                >
                  {line.content || "\u200B"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
