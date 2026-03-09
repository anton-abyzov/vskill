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

/** Tiny inline SVG sparkline showing pass rate trend */
export function MiniTrend({ entries }: { entries: CaseHistoryEntry[] }) {
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
