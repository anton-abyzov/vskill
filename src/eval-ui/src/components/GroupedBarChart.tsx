// Grouped bar chart using pure SVG — no external dependencies
// Designed for comparing two series (e.g., "With Skill" vs "Without Skill")

interface BarGroup {
  label: string;
  values: { value: number; label: string }[];
}

interface GroupedBarChartProps {
  title: string;
  groups: BarGroup[];
  seriesColors: string[];
  seriesLabels: string[];
  maxValue: number;
  /** Format value for display on top of bar. Default: (v) => v.toFixed(1) */
  formatValue?: (value: number) => string;
  /** Y-axis label */
  yLabel?: string;
}

const CHART_HEIGHT = 220;
const BAR_WIDTH = 32;
const BAR_GAP = 4;
const GROUP_GAP = 28;
const LEFT_PAD = 44;
const RIGHT_PAD = 16;
const TOP_PAD = 40;
const BOTTOM_PAD = 52;

export function GroupedBarChart({
  title,
  groups,
  seriesColors,
  seriesLabels,
  maxValue,
  formatValue = (v) => v.toFixed(1),
  yLabel,
}: GroupedBarChartProps) {
  const seriesCount = seriesLabels.length;
  const groupWidth = seriesCount * BAR_WIDTH + (seriesCount - 1) * BAR_GAP;
  const totalWidth = LEFT_PAD + RIGHT_PAD + groups.length * groupWidth + (groups.length - 1) * GROUP_GAP;
  const totalHeight = TOP_PAD + CHART_HEIGHT + BOTTOM_PAD;

  // Y-axis ticks
  const tickCount = 5;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (maxValue / tickCount) * i);

  return (
    <div className="glass-card p-5 overflow-x-auto animate-fade-in">
      <div className="text-[13px] font-semibold mb-4" style={{ color: "var(--text-primary)" }}>{title}</div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-3">
        {seriesLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-[3px]" style={{ background: seriesColors[i] }} />
            <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{label}</span>
          </div>
        ))}
      </div>

      <svg
        width={Math.max(totalWidth, 300)}
        height={totalHeight}
        viewBox={`0 0 ${Math.max(totalWidth, 300)} ${totalHeight}`}
        style={{ display: "block" }}
      >
        {/* Y-axis label */}
        {yLabel && (
          <text
            x={12}
            y={TOP_PAD + CHART_HEIGHT / 2}
            transform={`rotate(-90, 12, ${TOP_PAD + CHART_HEIGHT / 2})`}
            textAnchor="middle"
            style={{ fill: "var(--text-tertiary)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}
          >
            {yLabel}
          </text>
        )}

        {/* Y-axis ticks and grid lines */}
        {ticks.map((tick) => {
          const y = TOP_PAD + CHART_HEIGHT - (tick / maxValue) * CHART_HEIGHT;
          return (
            <g key={tick}>
              <line
                x1={LEFT_PAD}
                y1={y}
                x2={Math.max(totalWidth, 300) - RIGHT_PAD}
                y2={y}
                stroke="var(--border-subtle)"
                strokeWidth={tick === 0 ? 1 : 0.5}
                strokeDasharray={tick === 0 ? undefined : "4 4"}
              />
              <text
                x={LEFT_PAD - 8}
                y={y + 3.5}
                textAnchor="end"
                style={{ fill: "var(--text-tertiary)", fontSize: 10 }}
              >
                {tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Bar groups */}
        {groups.map((group, gi) => {
          const groupX = LEFT_PAD + gi * (groupWidth + GROUP_GAP);
          return (
            <g key={group.label}>
              {group.values.map((v, si) => {
                const barHeight = Math.max(0, (v.value / maxValue) * CHART_HEIGHT);
                const barX = groupX + si * (BAR_WIDTH + BAR_GAP);
                const barY = TOP_PAD + CHART_HEIGHT - barHeight;
                return (
                  <g key={si}>
                    {/* Bar */}
                    <rect
                      x={barX}
                      y={barY}
                      width={BAR_WIDTH}
                      height={barHeight}
                      rx={4}
                      ry={4}
                      fill={seriesColors[si]}
                      opacity={0.85}
                    >
                      <animate attributeName="height" from="0" to={barHeight} dur="0.5s" fill="freeze" />
                      <animate attributeName="y" from={TOP_PAD + CHART_HEIGHT} to={barY} dur="0.5s" fill="freeze" />
                    </rect>
                    {/* Value label on top */}
                    <text
                      x={barX + BAR_WIDTH / 2}
                      y={barY - 6}
                      textAnchor="middle"
                      style={{ fill: "var(--text-secondary)", fontSize: 10, fontWeight: 600 }}
                    >
                      {formatValue(v.value)}
                    </text>
                    {/* Fraction label */}
                    {v.label && (
                      <text
                        x={barX + BAR_WIDTH / 2}
                        y={barY - 17}
                        textAnchor="middle"
                        style={{ fill: "var(--text-tertiary)", fontSize: 9 }}
                      >
                        {v.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Group label (x-axis) */}
              <text
                x={groupX + groupWidth / 2}
                y={TOP_PAD + CHART_HEIGHT + 18}
                textAnchor="middle"
                style={{ fill: "var(--text-secondary)", fontSize: 11 }}
              >
                {truncateLabel(group.label, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function truncateLabel(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
