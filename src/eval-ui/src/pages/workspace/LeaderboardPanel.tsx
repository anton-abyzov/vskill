// T-049, T-050, T-051: Leaderboard panel — sweep results table with sparklines
import { useState, useEffect, useMemo } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import type { SweepResult, LeaderboardEntry } from "../../types";
import { passRateColor } from "../../utils/historyUtils";

// ---------------------------------------------------------------------------
// Sparkline — inline SVG polyline (follows TrendChart.tsx pattern)
// ---------------------------------------------------------------------------

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return <span style={{ color: "var(--text-tertiary)", fontSize: 10 }}>--</span>;

  const points = data.slice(-10); // cap at 10
  const w = 80;
  const h = 24;
  const pad = 2;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const n = points.length;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const coords = points.map((v, i) => {
    const x = pad + (i / (n - 1)) * plotW;
    const y = pad + plotH - ((v - min) / range) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = points[points.length - 1];
  const color = passRateColor(last);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* endpoint dot */}
      {(() => {
        const [lx, ly] = coords[coords.length - 1].split(",");
        return <circle cx={lx} cy={ly} r={2.5} fill={color} />;
      })()}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Best Model badge
// ---------------------------------------------------------------------------

function BestModelBadge() {
  return (
    <span
      className="pill"
      style={{
        background: "rgba(251,191,36,0.15)",
        color: "#fbbf24",
        fontSize: 9,
        fontWeight: 700,
        gap: 3,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      Best Model
    </span>
  );
}

// ---------------------------------------------------------------------------
// Build leaderboard entries from sweep results
// ---------------------------------------------------------------------------

function buildLeaderboard(sweeps: SweepResult[]): LeaderboardEntry[] {
  if (sweeps.length === 0) return [];

  // Aggregate: for each model, collect pass rates from all sweeps
  const modelMap = new Map<string, { provider: string; passRates: number[]; lastRubric: number | null; lastDuration: number; lastCost: number | null }>();

  for (const sweep of sweeps) {
    for (const m of sweep.models) {
      if (m.status === "error") continue;
      const key = `${m.provider}/${m.model}`;
      if (!modelMap.has(key)) {
        modelMap.set(key, { provider: m.provider, passRates: [], lastRubric: null, lastDuration: 0, lastCost: null });
      }
      const entry = modelMap.get(key)!;
      entry.passRates.push(m.passRate.mean);
      entry.lastRubric = m.rubricScore?.mean ?? null;
      entry.lastDuration = m.duration.mean;
      entry.lastCost = m.cost?.total ?? null;
    }
  }

  // Build entries
  const entries: LeaderboardEntry[] = [];
  for (const [key, data] of modelMap) {
    const [provider, ...modelParts] = key.split("/");
    entries.push({
      rank: 0,
      model: modelParts.join("/"),
      provider,
      passRate: data.passRates[data.passRates.length - 1],
      rubricScore: data.lastRubric,
      duration: data.lastDuration,
      cost: data.lastCost,
      sparklineData: data.passRates,
      isBest: false,
    });
  }

  // Sort by pass rate desc, assign rank
  entries.sort((a, b) => b.passRate - a.passRate);
  entries.forEach((e, i) => { e.rank = i + 1; });
  if (entries.length > 0) entries[0].isBest = true;

  return entries;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LeaderboardPanel() {
  const { state } = useWorkspace();
  const { plugin, skill } = state;

  const [sweeps, setSweeps] = useState<SweepResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getLeaderboard(plugin, skill)
      .then((res) => setSweeps(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  const entries = useMemo(() => buildLeaderboard(sweeps), [sweeps]);

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex items-center justify-center h-full px-8">
        <div className="text-center">
          <div className="text-[14px] font-medium mb-1" style={{ color: "var(--red)" }}>Failed to load leaderboard</div>
          <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>{error}</div>
        </div>
      </div>
    );
  }

  // T-051: Empty state
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-8">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--accent-muted)" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10" />
            <path d="M12 20V4" />
            <path d="M6 20v-6" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-[14px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>No sweep results yet</div>
          <div className="text-[12px] mb-3" style={{ color: "var(--text-tertiary)" }}>
            Run your first model sweep to compare performance across models:
          </div>
          <div
            className="text-[11px] font-mono px-4 py-3 rounded-lg text-left"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
          >
            vskill eval sweep --models "anthropic/claude-sonnet-4,openrouter/meta-llama/llama-3.1-70b" --judge "anthropic/claude-sonnet-4"
          </div>
        </div>
      </div>
    );
  }

  // T-049: Leaderboard table
  return (
    <div className="p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Model Leaderboard
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {sweeps.length} sweep{sweeps.length !== 1 ? "s" : ""} &middot; {entries.length} model{entries.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="glass-card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
              {["#", "Model", "Pass Rate", "Rubric", "Duration", "Cost", "Trend"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--text-tertiary)",
                    textAlign: h === "#" ? "center" : "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr
                key={`${entry.provider}/${entry.model}`}
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {/* Rank */}
                <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", width: 40 }}>
                  {entry.rank}
                </td>

                {/* Model */}
                <td style={{ padding: "10px 12px" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {entry.model}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                      {entry.provider}
                    </span>
                    {entry.isBest && <BestModelBadge />}
                  </div>
                </td>

                {/* Pass Rate */}
                <td style={{ padding: "10px 12px" }}>
                  <span
                    className="pill"
                    style={{
                      background: entry.passRate >= 0.7
                        ? "var(--green-muted)"
                        : entry.passRate >= 0.4
                          ? "var(--yellow-muted)"
                          : "var(--red-muted)",
                      color: passRateColor(entry.passRate),
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {Math.round(entry.passRate * 100)}%
                  </span>
                </td>

                {/* Rubric */}
                <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                  {entry.rubricScore != null ? entry.rubricScore.toFixed(1) : "--"}
                </td>

                {/* Duration */}
                <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                  {entry.duration < 1000 ? `${Math.round(entry.duration)}ms` : `${(entry.duration / 1000).toFixed(1)}s`}
                </td>

                {/* Cost */}
                <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                  {entry.cost != null ? `$${entry.cost.toFixed(4)}` : "N/A"}
                </td>

                {/* Sparkline */}
                <td style={{ padding: "10px 12px" }}>
                  <Sparkline data={entry.sparklineData} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
