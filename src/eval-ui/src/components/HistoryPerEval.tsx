import { useEffect, useState } from "react";
import { api } from "../api";
import type { CaseHistoryEntry, EvalsFile } from "../types";

interface HistoryPerEvalProps {
  plugin: string;
  skill: string;
}

function passRateColor(rate: number): string {
  if (rate >= 0.8) return "var(--green)";
  if (rate >= 0.5) return "var(--yellow)";
  return "var(--red)";
}

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

/** Tiny inline SVG sparkline */
function MiniTrend({ entries }: { entries: CaseHistoryEntry[] }) {
  if (entries.length < 2) return null;
  const w = 80, h = 24, pad = 2;
  const pts = entries.slice().reverse(); // oldest first
  const n = pts.length;
  const coords = pts.map((e, i) => {
    const x = pad + (i / (n - 1)) * (w - pad * 2);
    const y = pad + (h - pad * 2) - e.pass_rate * (h - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Latest point */}
      {coords.length > 0 && (
        <circle
          cx={parseFloat(coords[coords.length - 1].split(",")[0])}
          cy={parseFloat(coords[coords.length - 1].split(",")[1])}
          r={2.5}
          fill="var(--accent)"
        />
      )}
    </svg>
  );
}

export function HistoryPerEval({ plugin, skill }: HistoryPerEvalProps) {
  const [evals, setEvals] = useState<EvalsFile | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [caseHistory, setCaseHistory] = useState<Record<number, CaseHistoryEntry[]>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});

  useEffect(() => {
    api.getEvals(plugin, skill).then(setEvals).catch(() => setEvals(null));
  }, [plugin, skill]);

  async function toggleExpand(evalId: number) {
    if (expandedId === evalId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(evalId);
    if (!caseHistory[evalId]) {
      setLoading((p) => ({ ...p, [evalId]: true }));
      try {
        const entries = await api.getCaseHistory(plugin, skill, evalId);
        setCaseHistory((p) => ({ ...p, [evalId]: entries }));
      } catch {
        setCaseHistory((p) => ({ ...p, [evalId]: [] }));
      } finally {
        setLoading((p) => ({ ...p, [evalId]: false }));
      }
    }
  }

  if (!evals) {
    return (
      <div className="text-center py-12">
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>No eval cases found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 stagger-children">
      {evals.evals.map((ec) => {
        const history = caseHistory[ec.id] || [];
        const isExpanded = expandedId === ec.id;
        const isLoading = loading[ec.id];
        const latestRate = history.length > 0 ? history[0].pass_rate : null;

        return (
          <div key={ec.id} className="glass-card overflow-hidden">
            {/* Card header */}
            <button
              onClick={() => toggleExpand(ec.id)}
              className="w-full text-left p-4 flex items-center gap-3 transition-colors duration-150"
              style={{ background: isExpanded ? "var(--surface-2)" : "transparent" }}
              onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = "var(--surface-2)"; }}
              onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = "transparent"; }}
            >
              {/* Expand chevron */}
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s ease", flexShrink: 0 }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>

              {/* ID badge */}
              <span
                className="text-[11px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
              >
                #{ec.id}
              </span>

              {/* Name */}
              <span className="text-[13px] font-medium flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                {ec.name}
              </span>

              {/* Mini trend */}
              {history.length >= 2 && <MiniTrend entries={history} />}

              {/* Latest pass rate */}
              {latestRate != null && (
                <span
                  className="text-[12px] font-semibold flex-shrink-0"
                  style={{ color: passRateColor(latestRate) }}
                >
                  {Math.round(latestRate * 100)}%
                </span>
              )}

              {/* Run count */}
              {history.length > 0 && (
                <span className="text-[10px] flex-shrink-0" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>
                  {history.length} runs
                </span>
              )}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="border-t animate-fade-in" style={{ borderColor: "var(--border-subtle)" }}>
                {isLoading ? (
                  <div className="p-4 flex items-center gap-2">
                    <div className="spinner" style={{ width: 14, height: 14 }} />
                    <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>Loading history...</span>
                  </div>
                ) : history.length === 0 ? (
                  <div className="p-4">
                    <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>No history for this eval case</p>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                    {history.map((entry, idx) => (
                      <div key={idx} className="p-4" style={{ background: idx === 0 ? "var(--surface-2)" : "transparent" }}>
                        {/* Run header */}
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                            {shortDate(entry.timestamp)}
                          </span>
                          <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{entry.model}</span>
                          <span
                            className="pill"
                            style={{
                              fontSize: 9, padding: "1px 6px",
                              background: entry.type === "benchmark" ? "rgba(99,131,255,0.15)" : entry.type === "comparison" ? "var(--purple-muted)" : "rgba(251,146,60,0.15)",
                              color: entry.type === "benchmark" ? "#6383ff" : entry.type === "comparison" ? "var(--purple)" : "#fb923c",
                            }}
                          >
                            {entry.type}
                          </span>
                          <span className="text-[12px] font-semibold ml-auto" style={{ color: passRateColor(entry.pass_rate) }}>
                            {Math.round(entry.pass_rate * 100)}%
                          </span>
                        </div>

                        {/* Metrics */}
                        <div className="flex items-center gap-4 mb-2 text-[10px]" style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--text-tertiary)" }}>
                          {entry.durationMs != null && <span>{fmtDuration(entry.durationMs)}</span>}
                          {entry.tokens != null && <span>{entry.tokens >= 1000 ? `${(entry.tokens / 1000).toFixed(1)}k` : entry.tokens} tok</span>}
                        </div>

                        {/* Assertions */}
                        <div className="space-y-1">
                          {entry.assertions.map((a) => (
                            <div key={a.id} className="flex items-start gap-2 py-0.5">
                              <div
                                className="w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                                style={{ background: a.pass ? "var(--green)" : "var(--red)" }}
                              >
                                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                  {a.pass ? <polyline points="20 6 9 17 4 12" /> : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px]" style={{ color: "var(--text-primary)" }}>{a.text}</div>
                                {a.reasoning && (
                                  <div className="text-[10px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{a.reasoning}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
