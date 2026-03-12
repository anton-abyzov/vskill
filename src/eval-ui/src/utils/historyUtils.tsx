import type { CaseHistoryEntry } from "../types";

export function passRateColor(rate: number): string {
  if (rate >= 0.8) return "var(--green)";
  if (rate >= 0.5) return "var(--yellow)";
  return "var(--red)";
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDuration(ms: number | undefined): string {
  if (ms == null) return "--";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const CORE_TYPES = new Set(["benchmark", "comparison", "baseline"]);

function toCoords(pts: Array<{ rate: number; idx: number; total: number }>, w: number, h: number, pad: number) {
  return pts.map(({ rate, idx, total }) => {
    const x = pad + (idx / (total - 1)) * (w - pad * 2);
    const y = pad + (h - pad * 2) - rate * (h - pad * 2);
    return `${x},${y}`;
  });
}

/** Dual-line inline SVG sparkline: blue=skill, gray=baseline */
export function MiniTrend({ entries }: { entries: CaseHistoryEntry[] }) {
  const core = entries.filter((e) => CORE_TYPES.has(e.type)).slice().reverse(); // oldest first

  // Skill line: benchmark + comparison
  const skillPts = core
    .map((e, i, arr) => ({ rate: e.pass_rate, idx: i, total: arr.length }))
    .filter((_, i) => {
      const t = core[i].type;
      return t === "benchmark" || t === "comparison";
    });

  // Baseline line: baseline + comparison (using baselinePassRate)
  const basePts = core
    .flatMap((e, i) => {
      if (e.type === "baseline") return [{ rate: e.pass_rate, idx: i, total: core.length }];
      if (e.type === "comparison" && e.baselinePassRate != null) return [{ rate: e.baselinePassRate, idx: i, total: core.length }];
      return [];
    });

  if (skillPts.length < 2 && basePts.length < 2) return null;

  const w = 80, h = 24, pad = 2;
  const skillCoords = skillPts.length >= 2 ? toCoords(skillPts, w, h, pad) : [];
  const baseCoords = basePts.length >= 2 ? toCoords(basePts, w, h, pad) : [];
  const lastSkill = skillCoords[skillCoords.length - 1];
  const lastBase = baseCoords[baseCoords.length - 1];

  return (
    <svg width={w} height={h} style={{ display: "block", flexShrink: 0 }}>
      {baseCoords.length > 0 && (
        <polyline
          points={baseCoords.join(" ")}
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray="3 2"
        />
      )}
      {skillCoords.length > 0 && (
        <polyline
          points={skillCoords.join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {lastBase && (
        <circle
          cx={parseFloat(lastBase.split(",")[0])}
          cy={parseFloat(lastBase.split(",")[1])}
          r={2.5}
          fill="var(--text-tertiary)"
        />
      )}
      {lastSkill && (
        <circle
          cx={parseFloat(lastSkill.split(",")[0])}
          cy={parseFloat(lastSkill.split(",")[1])}
          r={2.5}
          fill="var(--accent)"
        />
      )}
    </svg>
  );
}
