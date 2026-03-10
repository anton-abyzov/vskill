import { useEffect, useState } from "react";
import { api } from "../api";
import type { StatsResult } from "../types";

interface StatsPanelProps {
  plugin: string;
  skill: string;
}

function passRateColor(rate: number): string {
  if (rate >= 0.8) return "var(--green)";
  if (rate >= 0.5) return "var(--yellow)";
  return "var(--red)";
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Horizontal bar for pass rates 0-1 */
function PassRateBar({ rate, label }: { rate: number; label: string }) {
  const pct = Math.round(rate * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] truncate" style={{ color: "var(--text-primary)", maxWidth: "70%" }}>{label}</span>
          <span className="text-[11px] font-semibold" style={{ color: passRateColor(rate) }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-3)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: passRateColor(rate) }}
          />
        </div>
      </div>
    </div>
  );
}

/** Mini SVG trend line for the stats overview */
function TrendLine({ points }: { points: Array<{ passRate: number }> }) {
  if (points.length < 2) return null;
  const w = 200, h = 48, pad = 4;
  const n = points.length;
  const coords = points.map((p, i) => {
    const x = pad + (i / (n - 1)) * (w - pad * 2);
    const y = pad + (h - pad * 2) - p.passRate * (h - pad * 2);
    return { x, y };
  });

  // Area fill
  const areaPath = `M ${coords[0].x},${h - pad} ` +
    coords.map((c) => `L ${c.x},${c.y}`).join(" ") +
    ` L ${coords[coords.length - 1].x},${h - pad} Z`;

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x},${c.y}`).join(" ");

  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={areaPath} fill="var(--accent-muted)" />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={3} fill="var(--accent)" />
    </svg>
  );
}

export function StatsPanel({ plugin, skill }: StatsPanelProps) {
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getStats(plugin, skill)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-24 rounded-xl" />
        <div className="skeleton h-48 rounded-xl" />
        <div className="skeleton h-36 rounded-xl" />
      </div>
    );
  }

  if (!stats || stats.totalRuns === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5">
            <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
          </svg>
        </div>
        <p className="text-[13px]" style={{ color: "var(--text-tertiary)" }}>No benchmark data yet</p>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-tertiary)" }}>Run some benchmarks to see statistics</p>
      </div>
    );
  }

  // Overall pass rate from latest trend point
  const latestRate = stats.trendPoints.length > 0 ? stats.trendPoints[stats.trendPoints.length - 1].passRate : 0;
  const firstRate = stats.trendPoints.length > 0 ? stats.trendPoints[0].passRate : 0;
  const rateDelta = latestRate - firstRate;

  // Worst assertions (bottom 10)
  const worstAssertions = stats.assertionStats.slice(0, 10);

  return (
    <div className="space-y-4 stagger-children">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
            Total Runs
          </div>
          <div className="text-[24px] font-bold" style={{ color: "var(--text-primary)" }}>
            {stats.totalRuns}
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
            Latest Pass Rate
          </div>
          <div className="text-[24px] font-bold" style={{ color: passRateColor(latestRate) }}>
            {Math.round(latestRate * 100)}%
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
            Trend
          </div>
          <div className="text-[24px] font-bold" style={{ color: rateDelta >= 0 ? "var(--green)" : "var(--red)" }}>
            {rateDelta >= 0 ? "+" : ""}{Math.round(rateDelta * 100)}%
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--text-tertiary)" }}>
            Models Tested
          </div>
          <div className="text-[24px] font-bold" style={{ color: "var(--text-primary)" }}>
            {stats.modelStats.length}
          </div>
        </div>
      </div>

      {/* Trend chart */}
      {stats.trendPoints.length >= 2 && (
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Pass Rate Over Time
          </div>
          <TrendLine points={stats.trendPoints} />
        </div>
      )}

      {/* Model comparison table */}
      {stats.modelStats.length > 0 && (
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Model Performance
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Model</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Runs</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Avg Pass Rate</th>
                <th style={{ textAlign: "center", padding: "6px 8px", color: "var(--text-tertiary)", fontWeight: 600, fontSize: 11 }}>Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.modelStats.map((m) => (
                <tr key={m.model} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px", color: "var(--text-primary)", fontWeight: 500 }}>{m.model}</td>
                  <td style={{ padding: "8px", textAlign: "center", fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" }}>{m.runs}</td>
                  <td style={{ padding: "8px", textAlign: "center" }}>
                    <span className="font-semibold" style={{ color: passRateColor(m.avgPassRate) }}>
                      {Math.round(m.avgPassRate * 100)}%
                    </span>
                  </td>
                  <td style={{ padding: "8px", textAlign: "center", fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" }}>
                    {fmtDuration(m.avgDurationMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Weakest assertions */}
      {worstAssertions.length > 0 && (
        <div className="glass-card p-5">
          <div className="text-[13px] font-semibold mb-3" style={{ color: "var(--text-primary)" }}>
            Weakest Assertions
          </div>
          <div className="space-y-3">
            {worstAssertions.map((a) => (
              <button
                key={`${a.evalId}:${a.id}`}
                className="block w-full text-left rounded-lg p-2 -mx-2 transition-colors duration-150"
                style={{ background: "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => { /* Already on history panel — no navigation needed */ }}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-[10px] font-mono px-1 py-0.5 rounded flex-shrink-0"
                    style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}
                  >
                    #{a.evalId}
                  </span>
                  <span className="text-[10px] truncate" style={{ color: "var(--text-tertiary)" }}>{a.evalName}</span>
                  <span className="text-[10px] ml-auto flex-shrink-0" style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-mono, monospace)" }}>
                    {a.totalRuns} runs
                  </span>
                </div>
                <PassRateBar rate={a.passRate} label={a.text} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
