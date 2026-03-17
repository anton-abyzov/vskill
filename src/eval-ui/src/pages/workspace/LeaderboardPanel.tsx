// Leaderboard panel — sweep results table with sparklines + skill amplification view
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
// Amplification badge
// ---------------------------------------------------------------------------

function AmplificationBadge({ pct }: { pct: number }) {
  const color = pct >= 10 ? "var(--green)" : pct >= 0 ? "var(--yellow)" : "var(--red)";
  const bg = pct >= 10 ? "var(--green-muted)" : pct >= 0 ? "var(--yellow-muted)" : "var(--red-muted)";
  const sign = pct >= 0 ? "+" : "";
  return (
    <span className="pill" style={{ background: bg, color, fontSize: 10, fontWeight: 600 }}>
      {sign}{pct.toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Skill Quality Badge
// ---------------------------------------------------------------------------

function SkillQualityBadge({ score, rating }: { score: number; rating: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    excellent: { bg: "var(--green-muted)", fg: "var(--green)" },
    good: { bg: "var(--green-muted)", fg: "var(--green)" },
    marginal: { bg: "var(--yellow-muted)", fg: "var(--yellow)" },
    minimal: { bg: "var(--yellow-muted)", fg: "var(--yellow)" },
    harmful: { bg: "var(--red-muted)", fg: "var(--red)" },
  };
  const c = colors[rating] ?? colors.minimal;
  const sign = score >= 0 ? "+" : "";
  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>Skill Quality:</span>
      <span className="pill" style={{ background: c.bg, color: c.fg, fontSize: 11, fontWeight: 600 }}>
        {sign}{score.toFixed(1)}% ({rating.toUpperCase()})
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Judge Bias Warning
// ---------------------------------------------------------------------------

function JudgeBiasWarning({ warning }: { warning: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3"
      style={{ background: "var(--yellow-muted)", border: "1px solid rgba(251,191,36,0.3)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span className="text-[11px]" style={{ color: "var(--yellow)" }}>{warning}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab selector
// ---------------------------------------------------------------------------

type LeaderboardTab = "rankings" | "amplification";

function TabSelector({ active, onChange, hasBaseline }: { active: LeaderboardTab; onChange: (t: LeaderboardTab) => void; hasBaseline: boolean }) {
  return (
    <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: "var(--surface-2)" }}>
      <button
        onClick={() => onChange("rankings")}
        className="px-3 py-1 rounded-md text-[11px] font-medium transition-all"
        style={{
          background: active === "rankings" ? "var(--surface-3)" : "transparent",
          color: active === "rankings" ? "var(--text-primary)" : "var(--text-tertiary)",
        }}
      >
        Rankings
      </button>
      <button
        onClick={() => onChange("amplification")}
        disabled={!hasBaseline}
        className="px-3 py-1 rounded-md text-[11px] font-medium transition-all"
        style={{
          background: active === "amplification" ? "var(--surface-3)" : "transparent",
          color: !hasBaseline ? "var(--text-tertiary)" : active === "amplification" ? "var(--text-primary)" : "var(--text-tertiary)",
          opacity: hasBaseline ? 1 : 0.5,
          cursor: hasBaseline ? "pointer" : "not-allowed",
        }}
        title={hasBaseline ? "View skill amplification data" : "Run sweep with --baseline to see amplification data"}
      >
        Skill Amplification
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build leaderboard entries from sweep results
// ---------------------------------------------------------------------------

function buildLeaderboard(sweeps: SweepResult[]): LeaderboardEntry[] {
  if (sweeps.length === 0) return [];

  const modelMap = new Map<string, {
    provider: string;
    passRates: number[];
    lastRubric: number | null;
    lastDuration: number;
    lastCost: number | null;
    lastBaselinePassRate: number | undefined;
    lastSkillDelta: number | undefined;
    lastAmplificationPct: number | undefined;
    lastCompositeScore: number | undefined;
    hasBaseline: boolean;
  }>();

  for (const sweep of sweeps) {
    for (const m of sweep.models) {
      if (m.status === "error") continue;
      const key = `${m.provider}/${m.model}`;
      if (!modelMap.has(key)) {
        modelMap.set(key, {
          provider: m.provider, passRates: [], lastRubric: null,
          lastDuration: 0, lastCost: null, lastBaselinePassRate: undefined,
          lastSkillDelta: undefined, lastAmplificationPct: undefined,
          lastCompositeScore: undefined, hasBaseline: false,
        });
      }
      const entry = modelMap.get(key)!;
      entry.passRates.push(m.passRate.mean);
      entry.lastRubric = m.rubricScore?.mean ?? null;
      entry.lastDuration = m.duration.mean;
      entry.lastCost = m.cost?.total ?? null;
      entry.lastCompositeScore = m.compositeScore;
      if (m.baselinePassRate != null) {
        entry.lastBaselinePassRate = m.baselinePassRate.mean;
        entry.lastSkillDelta = m.skillDelta?.mean;
        entry.lastAmplificationPct = m.amplificationPct;
        entry.hasBaseline = true;
      }
    }
  }

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
      baselinePassRate: data.lastBaselinePassRate,
      skillDelta: data.lastSkillDelta,
      amplificationPct: data.lastAmplificationPct,
      compositeScore: data.lastCompositeScore,
      hasBaseline: data.hasBaseline,
    });
  }

  // Sort by composite score, then pass rate
  entries.sort((a, b) => {
    if (a.compositeScore != null && b.compositeScore != null) {
      return b.compositeScore - a.compositeScore;
    }
    return b.passRate - a.passRate;
  });
  entries.forEach((e, i) => { e.rank = i + 1; });
  if (entries.length > 0) entries[0].isBest = true;

  return entries;
}

// ---------------------------------------------------------------------------
// Table header cell
// ---------------------------------------------------------------------------

const thStyle = (align: "center" | "left" = "left") => ({
  padding: "10px 12px",
  fontSize: 10,
  fontWeight: 600 as const,
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  textAlign: align,
  whiteSpace: "nowrap" as const,
});

// ---------------------------------------------------------------------------
// Rankings Table (original view)
// ---------------------------------------------------------------------------

function RankingsTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            {["#", "Model", "Pass Rate", "Rubric", "Duration", "Cost", "Trend"].map((h) => (
              <th key={h} style={thStyle(h === "#" ? "center" : "left")}>{h}</th>
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
              <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", width: 40 }}>
                {entry.rank}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{entry.model}</span>
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{entry.provider}</span>
                  {entry.isBest && <BestModelBadge />}
                </div>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <span className="pill" style={{
                  background: entry.passRate >= 0.7 ? "var(--green-muted)" : entry.passRate >= 0.4 ? "var(--yellow-muted)" : "var(--red-muted)",
                  color: passRateColor(entry.passRate), fontSize: 11, fontWeight: 600,
                }}>
                  {Math.round(entry.passRate * 100)}%
                </span>
              </td>
              <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                {entry.rubricScore != null ? entry.rubricScore.toFixed(1) : "--"}
              </td>
              <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                {entry.duration < 1000 ? `${Math.round(entry.duration)}ms` : `${(entry.duration / 1000).toFixed(1)}s`}
              </td>
              <td style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-secondary)" }}>
                {entry.cost != null ? `$${entry.cost.toFixed(4)}` : "N/A"}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <Sparkline data={entry.sparklineData} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amplification Table (new view for --baseline data)
// ---------------------------------------------------------------------------

function AmplificationTable({ entries }: { entries: LeaderboardEntry[] }) {
  // Sort by amplification (most helped first)
  const sorted = [...entries].filter((e) => e.hasBaseline).sort((a, b) => (b.amplificationPct ?? 0) - (a.amplificationPct ?? 0));

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <div className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
            No baseline data available. Run sweep with <code>--baseline</code> flag.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            {["#", "Model", "With Skill", "Without Skill", "Delta", "Amplification", "Trend"].map((h) => (
              <th key={h} style={thStyle(h === "#" ? "center" : "left")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => (
            <tr
              key={`${entry.provider}/${entry.model}`}
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <td style={{ padding: "10px 12px", textAlign: "center", fontSize: 12, fontWeight: 600, color: "var(--text-tertiary)", width: 40 }}>
                {i + 1}
              </td>
              <td style={{ padding: "10px 12px" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{entry.model}</span>
                  <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>{entry.provider}</span>
                </div>
              </td>
              <td style={{ padding: "10px 12px" }}>
                <span className="pill" style={{
                  background: entry.passRate >= 0.7 ? "var(--green-muted)" : entry.passRate >= 0.4 ? "var(--yellow-muted)" : "var(--red-muted)",
                  color: passRateColor(entry.passRate), fontSize: 11, fontWeight: 600,
                }}>
                  {Math.round(entry.passRate * 100)}%
                </span>
              </td>
              <td style={{ padding: "10px 12px" }}>
                {entry.baselinePassRate != null ? (
                  <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {Math.round(entry.baselinePassRate * 100)}%
                  </span>
                ) : "--"}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {entry.skillDelta != null ? (
                  <span className="text-[11px] font-medium" style={{
                    color: entry.skillDelta >= 0 ? "var(--green)" : "var(--red)",
                  }}>
                    {entry.skillDelta >= 0 ? "+" : ""}{(entry.skillDelta * 100).toFixed(1)}pp
                  </span>
                ) : "--"}
              </td>
              <td style={{ padding: "10px 12px" }}>
                {entry.amplificationPct != null && isFinite(entry.amplificationPct)
                  ? <AmplificationBadge pct={entry.amplificationPct} />
                  : "--"
                }
              </td>
              <td style={{ padding: "10px 12px" }}>
                <Sparkline data={entry.sparklineData} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
  const [tab, setTab] = useState<LeaderboardTab>("rankings");

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getLeaderboard(plugin, skill)
      .then((res) => setSweeps(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  const entries = useMemo(() => buildLeaderboard(sweeps), [sweeps]);
  const hasBaseline = sweeps.some((s) => s.baselineEnabled);
  const latestSweep = sweeps[0];
  const judgeBiasWarning = latestSweep?.judgeBiasWarning;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

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
          <div className="text-[11px] mt-2" style={{ color: "var(--text-tertiary)" }}>
            Add <code>--baseline</code> to measure skill amplification per model.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Model Leaderboard
          </div>
          <TabSelector active={tab} onChange={setTab} hasBaseline={hasBaseline} />
        </div>
        <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          {sweeps.length} sweep{sweeps.length !== 1 ? "s" : ""} &middot; {entries.length} model{entries.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Judge bias warning */}
      {judgeBiasWarning && <JudgeBiasWarning warning={judgeBiasWarning} />}

      {/* Table */}
      {tab === "rankings" ? (
        <RankingsTable entries={entries} />
      ) : (
        <AmplificationTable entries={entries} />
      )}

      {/* Skill quality badge */}
      {tab === "amplification" && latestSweep?.skillQualityScore != null && latestSweep?.skillQualityRating && (
        <SkillQualityBadge score={latestSweep.skillQualityScore} rating={latestSweep.skillQualityRating} />
      )}
    </div>
  );
}
