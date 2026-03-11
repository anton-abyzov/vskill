import type { SkillInfo } from "../types";

const STATUS_CONFIG: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  pass:    { bg: "var(--green-muted)", text: "var(--green)",  dot: "var(--green)",  label: "Passing" },
  fail:    { bg: "var(--red-muted)",   text: "var(--red)",    dot: "var(--red)",    label: "Failing" },
  pending: { bg: "var(--yellow-muted)", text: "var(--yellow)", dot: "var(--yellow)", label: "Pending" },
  stale:   { bg: "var(--orange-muted)", text: "var(--orange)", dot: "var(--orange)", label: "Stale" },
  missing: { bg: "var(--surface-3)",   text: "var(--text-tertiary)", dot: "var(--text-tertiary)", label: "No evals" },
};

interface Props {
  skill: SkillInfo;
  isSelected: boolean;
  onSelect: () => void;
}

export function SkillCard({ skill, isSelected, onSelect }: Props) {
  const status = STATUS_CONFIG[skill.benchmarkStatus] || STATUS_CONFIG.missing;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-2.5 transition-all duration-150"
      style={{
        background: isSelected ? "var(--surface-2)" : "transparent",
        cursor: "pointer",
        borderTop: "none",
        borderRight: "none",
        borderBottom: "1px solid var(--border-subtle)",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        display: "block",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = "var(--surface-2)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {skill.skill}
        </span>
        <span
          className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2"
          style={{ background: status.bg, color: status.text }}
        >
          <span className="rounded-full" style={{ width: 5, height: 5, background: status.dot }} />
          {status.label}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
        <span>{skill.evalCount} eval{skill.evalCount !== 1 ? "s" : ""}</span>
        <span style={{ color: "var(--border-subtle)" }}>|</span>
        <span>{skill.assertionCount} assert{skill.assertionCount !== 1 ? "s" : ""}</span>
        {skill.lastBenchmark && (
          <>
            <span style={{ color: "var(--border-subtle)" }}>|</span>
            <span>{new Date(skill.lastBenchmark).toLocaleDateString()}</span>
          </>
        )}
      </div>
    </button>
  );
}
