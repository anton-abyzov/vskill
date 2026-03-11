import type { EvalChange, EvalCase } from "../types";
import { EvalChangeCard } from "./EvalChangeCard";

interface Props {
  changes: EvalChange[];
  selections: Map<number, boolean>;
  currentEvals: EvalCase[];
  onToggle: (index: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

// Sort order: remove (0) -> modify (1) -> add (2)
const ACTION_ORDER: Record<string, number> = { remove: 0, modify: 1, add: 2 };

export function EvalChangesPanel({ changes, selections, currentEvals, onToggle, onSelectAll, onDeselectAll }: Props) {
  if (changes.length === 0) return null;

  // Build sorted list preserving original indices for selection keys
  const indexed = changes.map((c, i) => ({ change: c, originalIndex: i }));
  indexed.sort((a, b) => (ACTION_ORDER[a.change.action] ?? 2) - (ACTION_ORDER[b.change.action] ?? 2));

  const selectedCount = Array.from(selections.values()).filter(Boolean).length;

  return (
    <div className="mt-3 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Test Case Changes
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            ({selectedCount}/{changes.length} selected)
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onSelectAll}
            className="text-[10px] px-2 py-0.5 rounded transition-colors duration-150"
            style={{ color: "var(--accent)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Select All
          </button>
          <button
            onClick={onDeselectAll}
            className="text-[10px] px-2 py-0.5 rounded transition-colors duration-150"
            style={{ color: "var(--text-tertiary)", background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* Cards */}
      <div
        className="space-y-1.5 overflow-auto"
        style={{ maxHeight: 240 }}
      >
        {indexed.map(({ change, originalIndex }) => (
          <EvalChangeCard
            key={originalIndex}
            change={change}
            index={originalIndex}
            selected={selections.get(originalIndex) ?? false}
            onToggle={onToggle}
            originalEval={change.evalId != null ? currentEvals.find((e) => e.id === change.evalId) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
