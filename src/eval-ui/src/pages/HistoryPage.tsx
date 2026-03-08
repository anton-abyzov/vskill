import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api";
import type { HistorySummary, BenchmarkResult } from "../types";

export function HistoryPage() {
  const { plugin, skill } = useParams<{ plugin: string; skill: string }>();
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<BenchmarkResult | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);

  useEffect(() => {
    if (!plugin || !skill) return;
    api.getHistory(plugin, skill).then(setHistory).catch(() => {}).finally(() => setLoading(false));
  }, [plugin, skill]);

  async function loadRun(timestamp: string) {
    if (!plugin || !skill) return;
    setSelectedTimestamp(timestamp);
    try {
      const run = await api.getHistoryEntry(plugin, skill, timestamp);
      setSelectedRun(run);
    } catch {
      setSelectedRun(null);
    }
  }

  if (loading) {
    return (
      <div className="px-10 py-8 max-w-6xl">
        <div className="skeleton h-5 w-48 mb-6" />
        <div className="grid grid-cols-3 gap-6">
          <div className="space-y-2"><div className="skeleton h-20 rounded-xl" /><div className="skeleton h-20 rounded-xl" /></div>
          <div className="col-span-2"><div className="skeleton h-48 rounded-xl" /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-10 py-8 max-w-6xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5 text-[13px]">
        <Link to={`/skills/${plugin}/${skill}`} className="transition-colors duration-150" style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
        >
          {skill}
        </Link>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>History</span>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="col-span-1">
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-3 px-1" style={{ color: "var(--text-tertiary)" }}>
            Past Runs ({history.length})
          </div>

          {history.length === 0 && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>No benchmark runs yet</p>
            </div>
          )}

          <div className="space-y-1.5 stagger-children">
            {history.map((h) => {
              const isSelected = selectedTimestamp === h.timestamp;
              const pctColor = h.passRate >= 0.8 ? "var(--green)" : h.passRate >= 0.5 ? "var(--yellow)" : "var(--red)";
              return (
                <button
                  key={h.timestamp}
                  onClick={() => loadRun(h.timestamp)}
                  className="w-full text-left p-3.5 rounded-xl transition-all duration-150"
                  style={{
                    background: isSelected ? "var(--accent-muted)" : "var(--surface-1)",
                    border: isSelected ? "1px solid var(--border-active)" : "1px solid var(--border-subtle)",
                  }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border-hover)"; }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
                >
                  <div className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                    {new Date(h.timestamp).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{h.model}</span>
                    <span className="text-[11px] font-semibold" style={{ color: pctColor }}>
                      {Math.round(h.passRate * 100)}%
                    </span>
                    {h.type === "comparison" && (
                      <span className="pill" style={{ background: "var(--purple-muted)", color: "var(--purple)", fontSize: "9px", padding: "1px 6px" }}>
                        A/B
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="col-span-2">
          {selectedRun ? (
            <div className="space-y-3 animate-slide-in-right">
              {/* Header */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {new Date(selectedRun.timestamp).toLocaleString()}
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                      {selectedRun.model}
                    </div>
                  </div>
                  {selectedRun.verdict && (
                    <span className="text-[14px] font-bold" style={{
                      color: selectedRun.verdict === "EFFECTIVE" ? "var(--green)"
                        : selectedRun.verdict === "MARGINAL" ? "var(--yellow)"
                        : selectedRun.verdict === "DEGRADING" ? "var(--red)"
                        : "var(--orange)",
                    }}>
                      {selectedRun.verdict}
                    </span>
                  )}
                </div>
              </div>

              {/* Cases */}
              {selectedRun.cases.map((c) => (
                <div key={c.eval_id} className="glass-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>#{c.eval_id}</span>
                      <h4 className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>{c.eval_name}</h4>
                    </div>
                    <span className="pill" style={{
                      background: c.status === "pass" ? "var(--green-muted)" : c.status === "error" ? "var(--yellow-muted)" : "var(--red-muted)",
                      color: c.status === "pass" ? "var(--green)" : c.status === "error" ? "var(--yellow)" : "var(--red)",
                    }}>
                      {c.status} ({Math.round(c.pass_rate * 100)}%)
                    </span>
                  </div>
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
          ) : (
            <div className="text-center py-20">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "var(--surface-2)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </div>
              <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>Select a run to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
