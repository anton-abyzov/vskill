// Pure SVG trend chart — pass rate over time, color-coded by run type
// No external chart dependencies

import { useState } from "react";
import type { HistorySummary } from "../types";

interface TrendChartProps {
  entries: HistorySummary[];
}

const TYPE_COLORS: Record<string, string> = {
  benchmark: "#6383ff",
  comparison: "#a78bfa",
  baseline: "#fb923c",
};

const TYPE_LABELS: Record<string, string> = {
  benchmark: "Benchmark",
  comparison: "Comparison",
  baseline: "Baseline",
};

const WIDTH = 600;
const HEIGHT = 180;
const PAD = 40;
const PLOT_W = WIDTH - PAD * 2;
const PLOT_H = HEIGHT - PAD * 2;

const GRID_TICKS = [25, 50, 75, 100];

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({ entries }: TrendChartProps) {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    entry: HistorySummary;
  } | null>(null);

  if (entries.length < 2) return null;

  const n = entries.length;

  // Map each entry to chart coordinates
  const points = entries.map((entry, i) => {
    const x = PAD + (i / (n - 1)) * PLOT_W;
    const pct = entry.passRate * 100;
    const y = PAD + PLOT_H - (pct / 100) * PLOT_H;
    return { x, y, pct, entry };
  });

  // Build polyline path string
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");

  // Collect unique types present in data for legend
  const typesPresent = Array.from(new Set(entries.map((e) => e.type)));

  return (
    <div className="glass-card p-5 animate-fade-in" style={{ position: "relative" }}>
      <div className="text-[13px] font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
        Pass Rate Trend
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-3">
        {typesPresent.map((type) => (
          <div key={type} className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: TYPE_COLORS[type] ?? "var(--text-tertiary)" }}
            />
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {TYPE_LABELS[type] ?? type}
            </span>
          </div>
        ))}
      </div>

      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Gridlines + Y-axis labels */}
        {GRID_TICKS.map((tick) => {
          const y = PAD + PLOT_H - (tick / 100) * PLOT_H;
          return (
            <g key={tick}>
              <line
                x1={PAD}
                y1={y}
                x2={PAD + PLOT_W}
                y2={y}
                stroke="var(--border-subtle)"
                strokeWidth={0.5}
                strokeDasharray="4 4"
              />
              <text
                x={PAD - 8}
                y={y + 3.5}
                textAnchor="end"
                style={{ fill: "var(--text-tertiary)", fontSize: 10 }}
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Baseline axis (0%) */}
        <line
          x1={PAD}
          y1={PAD + PLOT_H}
          x2={PAD + PLOT_W}
          y2={PAD + PLOT_H}
          stroke="var(--border-subtle)"
          strokeWidth={1}
        />

        {/* Y-axis label */}
        <text
          x={PAD - 8}
          y={PAD + PLOT_H + 3.5}
          textAnchor="end"
          style={{ fill: "var(--text-tertiary)", fontSize: 10 }}
        >
          0%
        </text>

        {/* Connecting polyline */}
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill={TYPE_COLORS[p.entry.type] ?? "var(--text-tertiary)"}
            stroke="var(--surface-2)"
            strokeWidth={2}
            style={{ cursor: "pointer", transition: "r 0.15s ease" }}
            onMouseEnter={(e) => {
              (e.currentTarget as SVGCircleElement).setAttribute("r", "7");
              setTooltip({ x: p.x, y: p.y, entry: p.entry });
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as SVGCircleElement).setAttribute("r", "5");
              setTooltip(null);
            }}
          />
        ))}

        {/* X-axis labels (first, middle, last to avoid clutter) */}
        {labelIndices(n).map((i) => (
          <text
            key={i}
            x={points[i].x}
            y={PAD + PLOT_H + 16}
            textAnchor="middle"
            style={{ fill: "var(--text-tertiary)", fontSize: 10 }}
          >
            {formatShortDate(entries[i].timestamp)}
          </text>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: tooltip.x,
            top: tooltip.y - 12,
            transform: "translate(-50%, -100%)",
            background: "var(--surface-3)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: "8px 12px",
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}
        >
          <div className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
            {formatShortDate(tooltip.entry.timestamp)}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {tooltip.entry.model}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: TYPE_COLORS[tooltip.entry.type] ?? "var(--text-tertiary)",
                color: "#fff",
              }}
            >
              {TYPE_LABELS[tooltip.entry.type] ?? tooltip.entry.type}
            </span>
            <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {Math.round(tooltip.entry.passRate * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Pick a small set of x-axis label indices to avoid overlap. */
function labelIndices(n: number): number[] {
  if (n <= 3) return Array.from({ length: n }, (_, i) => i);
  if (n <= 6) return [0, Math.floor(n / 2), n - 1];
  return [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
}
