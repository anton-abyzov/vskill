import { VERDICT_STYLES } from "../utils/verdict-styles";
import type { ProgressiveSummary } from "../hooks/useProgressiveSummary";

interface RunningVerdictBarProps {
  summary: ProgressiveSummary;
}

export function RunningVerdictBar({ summary }: RunningVerdictBarProps) {
  const { completedCount, totalCount, skillAvg, baselineAvg, delta, previewVerdict } = summary;
  const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Placeholder state: no cases completed yet
  if (completedCount === 0) {
    return (
      <div
        className="glass-card p-5 mb-5 animate-fade-in"
        style={{ borderColor: "var(--border-subtle)", borderWidth: 1 }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="spinner" style={{ borderTopColor: "var(--accent)", borderColor: "var(--surface-3)", width: 14, height: 14 }} />
            <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>Comparing...</span>
          </div>
          <span className="text-[12px] font-mono" style={{ color: "var(--text-tertiary)" }}>
            0/{totalCount} cases
          </span>
        </div>
        <div className="h-1.5 rounded-full" style={{ background: "var(--surface-3)" }}>
          <div className="h-full rounded-full transition-all duration-300" style={{ width: "0%", background: "var(--accent)" }} />
        </div>
      </div>
    );
  }

  // Running or final state with results
  const vs = previewVerdict ? VERDICT_STYLES[previewVerdict] : null;
  const isFinal = completedCount === totalCount;

  return (
    <div
      className="glass-card p-5 mb-5 animate-fade-in"
      style={{
        borderColor: vs?.border ?? "var(--border-subtle)",
        borderWidth: vs ? 2 : 1,
        boxShadow: vs ? `0 0 20px ${vs.glow}` : undefined,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {!isFinal && (
            <div className="spinner" style={{ borderTopColor: vs?.text ?? "var(--accent)", borderColor: "var(--surface-3)", width: 14, height: 14 }} />
          )}
          <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {isFinal ? "Comparison Complete" : "Comparing..."}
          </span>
          {vs && previewVerdict && (
            <span
              className="pill font-bold text-[11px]"
              style={{ background: vs.bg, color: vs.text }}
              title={previewVerdict === "EMERGING" ? "Skill shows promise but pass rate is below 40%" : undefined}
            >
              {vs.label}
            </span>
          )}
        </div>
        <span className="text-[12px] font-mono" style={{ color: "var(--text-tertiary)" }}>
          {completedCount}/{totalCount} cases
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full mb-4" style={{ background: "var(--surface-3)" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: vs?.text ?? "var(--accent)" }}
        />
      </div>

      {/* Running metrics */}
      <div className="flex justify-center gap-8">
        <MetricPill label="Skill Avg" value={skillAvg.toFixed(1)} />
        <MetricPill label="Baseline Avg" value={baselineAvg.toFixed(1)} />
        <MetricPill
          label="Rubric Delta"
          value={`${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
          color={delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text-secondary)"}
        />
      </div>
    </div>
  );
}

function MetricPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[16px] font-bold" style={{ color: color ?? "var(--text-primary)" }}>{value}</div>
      <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>{label}</div>
    </div>
  );
}
