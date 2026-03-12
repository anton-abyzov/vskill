import type { ActionItems, ActionRecommendation } from "../types";

const REC_STYLES: Record<ActionRecommendation, { bg: string; text: string; border: string; label: string }> = {
  keep:    { bg: "var(--green-muted)",        text: "var(--green)",  border: "var(--green)",  label: "Keep" },
  improve: { bg: "var(--yellow-muted)",       text: "var(--yellow)", border: "var(--yellow)", label: "Improve" },
  rewrite: { bg: "rgba(251,146,60,0.12)",     text: "var(--orange)", border: "var(--orange)", label: "Rewrite" },
  remove:  { bg: "var(--red-muted)",          text: "var(--red)",    border: "var(--red)",    label: "Remove" },
};

interface ActionItemsPanelProps {
  actionItems: ActionItems;
  plugin: string;
  skill: string;
}

export function ActionItemsPanel({ actionItems, plugin, skill }: ActionItemsPanelProps) {
  const style = REC_STYLES[actionItems.recommendation] || REC_STYLES.improve;
  const showFixButton = actionItems.recommendation === "improve" || actionItems.recommendation === "rewrite";

  function handleApplyFix() {
    // Navigate to workspace editor with comparison context as query params
    const notes = [
      `A/B comparison recommendation: ${actionItems.recommendation}.`,
      actionItems.suggestedFocus ? `Focus: ${actionItems.suggestedFocus}` : "",
      actionItems.weaknesses.length > 0 ? `Weaknesses: ${actionItems.weaknesses.join("; ")}` : "",
    ].filter(Boolean).join(" ");

    window.location.href = `/workspace/${plugin}/${skill}?improve=true&notes=${encodeURIComponent(notes)}`;
  }

  return (
    <div
      className="glass-card p-6 animate-fade-in"
      style={{ borderColor: style.border, borderWidth: 1 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
            Recommended Action
          </div>
          <span
            className="pill font-bold text-[12px]"
            style={{ background: style.bg, color: style.text }}
          >
            {style.label}
          </span>
        </div>
        {showFixButton && (
          <button
            onClick={handleApplyFix}
            className="btn btn-purple text-[12px] px-3 py-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Apply AI Fix
          </button>
        )}
      </div>

      {/* Summary */}
      {actionItems.summary && (
        <p className="text-[13px] leading-relaxed mb-4" style={{ color: "var(--text-secondary)" }}>
          {actionItems.summary}
        </p>
      )}

      {/* Weaknesses + Strengths grid */}
      {(actionItems.weaknesses.length > 0 || actionItems.strengths.length > 0) && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          {actionItems.weaknesses.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--red)" }}>
                Weaknesses
              </div>
              <ul className="space-y-1.5">
                {actionItems.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--red)" }} />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actionItems.strengths.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "var(--green)" }}>
                Strengths
              </div>
              <ul className="space-y-1.5">
                {actionItems.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: "var(--green)" }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Suggested focus */}
      {actionItems.suggestedFocus && (
        <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--accent)" }}>
            Suggested Focus
          </div>
          <p className="text-[12px]" style={{ color: "var(--text-primary)" }}>
            {actionItems.suggestedFocus}
          </p>
        </div>
      )}
    </div>
  );
}
