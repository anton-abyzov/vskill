import { useEffect, useRef, useState } from "react";

export interface ProgressEntry {
  timestamp: number;
  evalId?: number;
  phase: string;
  message: string;
  current?: number;
  total?: number;
}

interface ProgressLogProps {
  entries: ProgressEntry[];
  isRunning: boolean;
}

function phaseIcon(phase: string, isLatest: boolean): React.JSX.Element {
  const spinnerPhases = new Set(["generating", "comparing", "judging", "judging_assertion", "preparing", "parsing", "generating_skill", "generating_baseline", "scoring"]);
  if (isLatest && spinnerPhases.has(phase)) {
    return <div className="spinner" style={{ width: 10, height: 10, flexShrink: 0 }} />;
  }
  // Completed phase
  const accentPhases = new Set(["generating", "comparing", "preparing", "generating_skill", "generating_baseline", "scoring"]);
  return (
    <div
      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ background: accentPhases.has(phase) ? "var(--accent)" : "var(--green)" }}
    />
  );
}

export function ProgressLog({ entries, isRunning }: ProgressLogProps) {
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, collapsed]);

  if (entries.length === 0 && !isRunning) return null;

  return (
    <div className="mt-2 animate-fade-in" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium transition-colors duration-150"
        style={{ color: "var(--text-tertiary)" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
      >
        <span className="flex items-center gap-2">
          {isRunning && <div className="spinner" style={{ width: 10, height: 10 }} />}
          Progress Log ({entries.length})
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: collapsed ? "rotate(0)" : "rotate(180deg)", transition: "transform 0.2s ease" }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
        <div
          ref={scrollRef}
          className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto"
        >
          {entries.map((entry, i) => {
            const isLatest = i === entries.length - 1 && isRunning;
            const relTime = i === 0
              ? "0s"
              : `+${((entry.timestamp - entries[0].timestamp) / 1000).toFixed(1)}s`;

            return (
              <div
                key={i}
                className="flex items-center gap-2 text-[11px] animate-fade-in"
                style={{ opacity: isLatest ? 1 : 0.7 }}
              >
                {phaseIcon(entry.phase, isLatest)}
                <span className="font-mono flex-shrink-0" style={{ color: "var(--text-tertiary)", width: 40 }}>
                  {relTime}
                </span>
                <span style={{ color: isLatest ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {entry.message}
                </span>
                {entry.current != null && entry.total != null && (
                  <span className="font-mono flex-shrink-0" style={{ color: "var(--text-tertiary)" }}>
                    [{entry.current}/{entry.total}]
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
