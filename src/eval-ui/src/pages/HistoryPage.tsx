import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { TrendChart } from "../components/TrendChart";
import { HistoryPerEval } from "../components/HistoryPerEval";
import { StatsPanel } from "../components/StatsPanel";
import type { HistorySummary, BenchmarkResult, HistoryCompareResult, HistoryFilter } from "../types";

type HistoryTab = "timeline" | "per-eval" | "statistics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null) return "--";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtTokens(t: number | null | undefined): string {
  if (t == null) return "--";
  if (t >= 1000) return `${(t / 1000).toFixed(1)}k tok`;
  return `${t} tok`;
}

function passRateColor(rate: number): string {
  if (rate >= 0.8) return "var(--green)";
  if (rate >= 0.5) return "var(--yellow)";
  return "var(--red)";
}

function passRateBg(rate: number): string {
  if (rate >= 0.8) return "var(--green-muted)";
  if (rate >= 0.5) return "var(--yellow-muted)";
  return "var(--red-muted)";
}

const TYPE_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  benchmark: { bg: "rgba(99,131,255,0.15)", fg: "#6383ff", label: "Benchmark" },
  comparison: { bg: "var(--purple-muted)", fg: "var(--purple)", label: "A/B" },
  baseline: { bg: "rgba(251,146,60,0.15)", fg: "#fb923c", label: "Baseline" },
};

function verdictColor(v: string | undefined): string {
  if (!v) return "var(--text-tertiary)";
  if (v === "EFFECTIVE") return "var(--green)";
  if (v === "MARGINAL") return "var(--yellow)";
  if (v === "DEGRADING") return "var(--red)";
  return "var(--text-secondary)";
}

// ---------------------------------------------------------------------------
// FilterBar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  models: string[];
  filters: HistoryFilter;
  onChange: (f: HistoryFilter) => void;
}

function FilterBar({ models, filters, onChange }: FilterBarProps) {
  const hasFilters = !!(filters.model || filters.type || filters.from || filters.to);

  const inputStyle: React.CSSProperties = {
    background: "var(--surface-2)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
    color: "var(--text-primary)",
    outline: "none",
  };

  return (
    <div
      className="flex items-center gap-3 flex-wrap animate-fade-in"
      style={{ marginBottom: 16 }}
    >
      {/* Model */}
      <select
        value={filters.model ?? ""}
        onChange={(e) => onChange({ ...filters, model: e.target.value || undefined })}
        style={inputStyle}
      >
        <option value="">All models</option>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {/* Type */}
      <select
        value={filters.type ?? ""}
        onChange={(e) => onChange({ ...filters, type: (e.target.value || undefined) as HistoryFilter["type"] })}
        style={inputStyle}
      >
        <option value="">All types</option>
        <option value="benchmark">Benchmark</option>
        <option value="comparison">Comparison</option>
        <option value="baseline">Baseline</option>
      </select>

      {/* From */}
      <input
        type="date"
        value={filters.from ?? ""}
        onChange={(e) => onChange({ ...filters, from: e.target.value || undefined })}
        style={inputStyle}
        placeholder="From"
      />

      {/* To */}
      <input
        type="date"
        value={filters.to ?? ""}
        onChange={(e) => onChange({ ...filters, to: e.target.value || undefined })}
        style={inputStyle}
        placeholder="To"
      />

      {hasFilters && (
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "4px 10px" }}
          onClick={() => onChange({})}
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompareView
// ---------------------------------------------------------------------------

interface CompareViewProps {
  result: HistoryCompareResult;
}

function CompareView({ result }: CompareViewProps) {
  const { runA, runB, caseDiffs } = result;

  return (
    <div className="space-y-3 animate-slide-in-right">
      {/* Header */}
      <div className="glass-card p-4">
        <div className="grid grid-cols-2 gap-4">
          {[runA, runB].map((run, idx) => (
            <div key={idx}>
              <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
                Run {idx === 0 ? "A" : "B"}
              </div>
              <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                {shortDate(run.timestamp)}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{run.model}</div>
              <div className="text-[12px] font-semibold mt-1" style={{ color: passRateColor(run.passRate) }}>
                {Math.round(run.passRate * 100)}% pass
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Case diff table */}
      <div className="glass-card p-4 overflow-x-auto">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Case</th>
              <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Run A</th>
              <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Run B</th>
              <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Duration</th>
              <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {caseDiffs.map((cd) => {
              const isRegression = cd.statusA === "pass" && cd.statusB !== "pass";
              const isImprovement = cd.statusA !== "pass" && cd.statusB === "pass";
              const rowBg = isRegression
                ? "var(--red-muted)"
                : isImprovement
                  ? "var(--green-muted)"
                  : "transparent";

              return (
                <tr key={cd.eval_id} style={{ background: rowBg, borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", color: "var(--text-primary)", fontWeight: 500 }}>
                    {cd.eval_name}
                  </td>

                  {/* Run A status */}
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    {cd.statusA === "missing" ? (
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)", fontSize: 9, padding: "1px 6px" }}>removed</span>
                    ) : (
                      <span style={{ color: passRateColor(cd.passRateA ?? 0), fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
                        {cd.statusA} {cd.passRateA != null ? `${Math.round(cd.passRateA * 100)}%` : ""}
                      </span>
                    )}
                  </td>

                  {/* Run B status */}
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    {cd.statusB === "missing" ? (
                      <span className="pill" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)", fontSize: 9, padding: "1px 6px" }}>new</span>
                    ) : (
                      <span style={{ color: passRateColor(cd.passRateB ?? 0), fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
                        {cd.statusB} {cd.passRateB != null ? `${Math.round(cd.passRateB * 100)}%` : ""}
                      </span>
                    )}
                  </td>

                  {/* Duration diff */}
                  <td style={{ padding: "8px", textAlign: "center", fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {cd.durationMsA != null || cd.durationMsB != null
                      ? `${fmtDuration(cd.durationMsA ?? undefined)} / ${fmtDuration(cd.durationMsB ?? undefined)}`
                      : "--"}
                  </td>

                  {/* Tokens diff */}
                  <td style={{ padding: "8px", textAlign: "center", fontFamily: "var(--font-mono, monospace)", fontSize: 11, color: "var(--text-secondary)" }}>
                    {cd.tokensA != null || cd.tokensB != null
                      ? `${fmtTokens(cd.tokensA)} / ${fmtTokens(cd.tokensB)}`
                      : "--"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Regressions summary */}
      {result.regressions.length > 0 && (
        <div className="glass-card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
            Assertion Changes ({result.regressions.length})
          </div>
          <div className="space-y-1">
            {result.regressions.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: r.change === "regression" ? "var(--red)" : "var(--green)" }}>
                <span>{r.change === "regression" ? "\u2193" : "\u2191"}</span>
                <span style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}>#{r.evalId}</span>
                <span style={{ color: "var(--text-primary)" }}>{r.evalName}</span>
                <span className="pill" style={{
                  background: r.change === "regression" ? "var(--red-muted)" : "var(--green-muted)",
                  color: r.change === "regression" ? "var(--red)" : "var(--green)",
                  fontSize: 9,
                  padding: "1px 6px",
                }}>
                  {r.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SingleRunDetail
// ---------------------------------------------------------------------------

interface SingleRunDetailProps {
  run: BenchmarkResult;
  plugin: string;
  skill: string;
  onDelete: (timestamp: string) => void;
}

function SingleRunDetail({ run, plugin, skill, onDelete }: SingleRunDetailProps) {
  const navigate = useNavigate();

  return (
    <div className="space-y-3 animate-slide-in-right">
      {/* Header */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
              {new Date(run.timestamp).toLocaleString()}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {run.model}
            </div>
          </div>
          {run.verdict && (
            <span className="text-[14px] font-bold" style={{ color: verdictColor(run.verdict) }}>
              {run.verdict}
            </span>
          )}
        </div>

        {/* Rerun buttons */}
        <div className="flex items-center gap-2 mt-3">
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => navigate(`/skills/${plugin}/${skill}/benchmark?autostart=true`)}
          >
            Rerun Benchmark
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => navigate(`/skills/${plugin}/${skill}/benchmark?mode=baseline&autostart=true`)}
          >
            Run Baseline
          </button>
          <button
            className="btn btn-purple"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => navigate(`/skills/${plugin}/${skill}/compare?autostart=true`)}
          >
            Run A/B
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: "3px 10px", color: "var(--red)" }}
            onClick={() => {
              if (confirm("Delete this run?")) onDelete(run.timestamp);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Cases */}
      {run.cases.map((c) => (
        <div key={c.eval_id} className="glass-card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
              >
                #{c.eval_id}
              </span>
              <h4 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                {c.eval_name}
              </h4>
            </div>
            <span
              className="pill"
              style={{
                background: c.status === "pass" ? "var(--green-muted)" : c.status === "error" ? "var(--yellow-muted)" : "var(--red-muted)",
                color: c.status === "pass" ? "var(--green)" : c.status === "error" ? "var(--yellow)" : "var(--red)",
              }}
            >
              {c.status} ({Math.round(c.pass_rate * 100)}%)
            </span>
          </div>

          {/* Metrics row */}
          {(c.durationMs != null || c.inputTokens != null || c.outputTokens != null) && (
            <div className="flex items-center gap-4 mb-3 text-[11px]" style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-tertiary)" }}>
              {c.durationMs != null && <span>{fmtDuration(c.durationMs)}</span>}
              {c.inputTokens != null && <span>{fmtTokens(c.inputTokens)} in</span>}
              {c.outputTokens != null && <span>{fmtTokens(c.outputTokens)} out</span>}
            </div>
          )}

          {c.error_message && (
            <div className="text-[12px] mb-3 p-2 rounded" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
              {c.error_message}
            </div>
          )}

          <div className="space-y-1.5">
            {c.assertions.map((a) => (
              <div key={a.id} className="flex items-start gap-2.5 py-1.5">
                <div
                  className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: a.pass ? "var(--green)" : "var(--red)" }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    {a.pass ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px]" style={{ color: "var(--text-primary)" }}>{a.text}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{a.reasoning}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryPage
// ---------------------------------------------------------------------------

export function HistoryPage() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as HistoryTab) || "timeline";
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<HistoryFilter>({});
  const [selectedRun, setSelectedRun] = useState<BenchmarkResult | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [compareChecked, setCompareChecked] = useState<Set<string>>(new Set());
  const [compareResult, setCompareResult] = useState<HistoryCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Unique models for filter dropdown
  const uniqueModels = useMemo(() => {
    const set = new Set(history.map((h) => h.model));
    return Array.from(set).sort();
  }, [history]);

  const fetchHistory = useCallback(async (f: HistoryFilter) => {
    if (!plugin || !skill) return;
    setLoading(true);
    try {
      const data = await api.getHistory(plugin, skill, f);
      setHistory(data);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [plugin, skill]);

  useEffect(() => {
    fetchHistory(filters);
  }, [fetchHistory, filters]);

  function handleFilterChange(f: HistoryFilter) {
    setFilters(f);
    // Clear selection when filters change
    setSelectedRun(null);
    setSelectedTimestamp(null);
    setCompareResult(null);
    setCompareChecked(new Set());
  }

  async function loadRun(timestamp: string) {
    if (!plugin || !skill) return;
    setCompareResult(null);
    setSelectedTimestamp(timestamp);
    try {
      const run = await api.getHistoryEntry(plugin, skill, timestamp);
      setSelectedRun(run);
    } catch {
      setSelectedRun(null);
    }
  }

  async function handleDelete(timestamp: string) {
    if (!plugin || !skill) return;
    try {
      await api.deleteHistoryEntry(plugin, skill, timestamp);
      setSelectedRun(null);
      setSelectedTimestamp(null);
      fetchHistory(filters);
    } catch {
      // ignore
    }
  }

  function toggleCompareCheck(timestamp: string) {
    setCompareChecked((prev) => {
      const next = new Set(prev);
      if (next.has(timestamp)) {
        next.delete(timestamp);
      } else {
        if (next.size >= 2) return prev; // max 2
        next.add(timestamp);
      }
      return next;
    });
  }

  async function executeCompare() {
    if (!plugin || !skill) return;
    const [a, b] = Array.from(compareChecked);
    if (!a || !b) return;
    setCompareLoading(true);
    try {
      const result = await api.compareRuns(plugin, skill, a, b);
      setCompareResult(result);
      setSelectedRun(null);
      setSelectedTimestamp(null);
    } catch {
      setCompareResult(null);
    } finally {
      setCompareLoading(false);
    }
  }

  function toggleCompareMode() {
    if (compareMode) {
      // Exiting compare mode
      setCompareMode(false);
      setCompareChecked(new Set());
      setCompareResult(null);
    } else {
      setCompareMode(true);
      setCompareResult(null);
    }
  }

  // Skeleton loading
  if (loading && history.length === 0) {
    return (
      <div className="px-10 py-8 max-w-6xl">
        <div className="skeleton h-5 w-48 mb-6" />
        <div className="skeleton h-48 rounded-xl mb-4" />
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="skeleton h-20 rounded-xl" />
            <div className="skeleton h-20 rounded-xl" />
            <div className="skeleton h-20 rounded-xl" />
          </div>
          <div className="col-span-2">
            <div className="skeleton h-48 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  const hasAnyFilter = !!(filters.model || filters.type || filters.from || filters.to);

  return (
    <div className="px-10 py-8 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-[13px]">
        <Link
          to={`/skills/${plugin}/${skill}`}
          className="transition-colors duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          {skill}
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>History</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-5 p-1 rounded-lg" style={{ background: "var(--surface-2)", display: "inline-flex" }}>
        {(["timeline", "per-eval", "statistics"] as HistoryTab[]).map((tab) => {
          const labels: Record<HistoryTab, string> = { timeline: "Timeline", "per-eval": "Per Eval", statistics: "Statistics" };
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setSearchParams({ tab })}
              className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all duration-150"
              style={{
                background: isActive ? "var(--surface-4)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-tertiary)",
                boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.2)" : "none",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = isActive ? "var(--text-primary)" : "var(--text-tertiary)"; }}
            >
              {labels[tab]}
            </button>
          );
        })}
      </div>

      {/* Per-Eval tab */}
      {activeTab === "per-eval" && plugin && skill && (
        <HistoryPerEval plugin={plugin} skill={skill} />
      )}

      {/* Statistics tab */}
      {activeTab === "statistics" && plugin && skill && (
        <StatsPanel plugin={plugin} skill={skill} />
      )}

      {/* Timeline tab */}
      {activeTab === "timeline" && <>
      {/* TrendChart */}
      {history.length >= 2 && (
        <div style={{ marginBottom: 16 }}>
          <TrendChart entries={history.slice().reverse()} />
        </div>
      )}

      {/* FilterBar */}
      <FilterBar models={uniqueModels} filters={filters} onChange={handleFilterChange} />

      {/* Main grid: timeline (1 col) + detail (2 cols) */}
      <div className="grid grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="col-span-1">
          <div className="flex items-center justify-between mb-3 px-1">
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Past Runs ({history.length})
            </div>
            <div className="flex items-center gap-2">
              {compareMode && compareChecked.size === 2 && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 10, padding: "2px 8px" }}
                  onClick={executeCompare}
                  disabled={compareLoading}
                >
                  {compareLoading ? "Comparing..." : "Compare Selected"}
                </button>
              )}
              <button
                className={`btn ${compareMode ? "btn-purple" : "btn-ghost"}`}
                style={{ fontSize: 10, padding: "2px 8px" }}
                onClick={toggleCompareMode}
              >
                Compare
              </button>
            </div>
          </div>

          {/* No history */}
          {history.length === 0 && !hasAnyFilter && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>No benchmark runs yet</p>
            </div>
          )}

          {/* No filter matches */}
          {history.length === 0 && hasAnyFilter && (
            <div className="text-center py-8">
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>No runs match current filters</p>
            </div>
          )}

          {/* Timeline items */}
          <div className="space-y-1.5 stagger-children">
            {history.map((h) => {
              const isSelected = selectedTimestamp === h.timestamp;
              const pctColor = passRateColor(h.passRate);
              const typePill = TYPE_PILL[h.type];
              const isChecked = compareChecked.has(h.timestamp);

              return (
                <div
                  key={h.timestamp}
                  className="flex items-start gap-2"
                >
                  {/* Compare checkbox */}
                  {compareMode && (
                    <label
                      className="flex items-center justify-center mt-3.5 flex-shrink-0 cursor-pointer"
                      style={{ width: 18, height: 18 }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCompareCheck(h.timestamp)}
                        disabled={!isChecked && compareChecked.size >= 2}
                        style={{ accentColor: "var(--purple)" }}
                      />
                    </label>
                  )}

                  <button
                    onClick={() => loadRun(h.timestamp)}
                    className="w-full text-left p-3.5 rounded-xl transition-all duration-150"
                    style={{
                      background: isSelected ? "var(--accent-muted)" : "var(--surface-1)",
                      border: isSelected ? "1px solid var(--border-active)" : "1px solid var(--border-subtle)",
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
                  >
                    {/* Row 1: date + type pill */}
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                        {shortDate(h.timestamp)}
                      </div>
                      {typePill && (
                        <span
                          className="pill"
                          style={{ background: typePill.bg, color: typePill.fg, fontSize: 9, padding: "1px 6px" }}
                        >
                          {typePill.label}
                        </span>
                      )}
                    </div>

                    {/* Row 2: model + pass rate */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{h.model}</span>
                      <span className="text-[11px] font-semibold" style={{ color: pctColor }}>
                        {Math.round(h.passRate * 100)}%
                      </span>
                    </div>

                    {/* Row 3: metrics */}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-tertiary)" }}>
                      <span>{h.caseCount ?? 0} cases</span>
                      <span>{fmtDuration(h.totalDurationMs ?? undefined)}</span>
                      <span>{fmtTokens(h.totalTokens)}</span>
                    </div>

                    {/* Verdict pill for comparison runs */}
                    {h.type === "comparison" && h.verdict && (
                      <div className="mt-1.5">
                        <span
                          className="pill"
                          style={{
                            background: h.verdict === "EFFECTIVE" ? "var(--green-muted)"
                              : h.verdict === "MARGINAL" ? "var(--yellow-muted)"
                              : h.verdict === "DEGRADING" ? "var(--red-muted)"
                              : "var(--surface-3)",
                            color: verdictColor(h.verdict),
                            fontSize: 9,
                            padding: "1px 6px",
                          }}
                        >
                          {h.verdict}
                        </span>
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail panel */}
        <div className="col-span-2">
          {compareResult ? (
            <CompareView result={compareResult} />
          ) : selectedRun && plugin && skill ? (
            <SingleRunDetail run={selectedRun} plugin={plugin} skill={skill} onDelete={handleDelete} />
          ) : (
            <div className="text-center py-20">
              <button
                onClick={() => navigate(`/skills/${plugin}/${skill}`)}
                className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all duration-150"
                style={{ background: "var(--surface-2)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.transform = "scale(1.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.transform = "scale(1)"; }}
                title="Back to skill"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>
                {compareMode ? "Check two runs and click Compare Selected" : "Select a run to view details"}
              </p>
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}
