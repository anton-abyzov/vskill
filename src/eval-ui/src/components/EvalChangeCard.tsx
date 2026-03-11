import { useState, useCallback } from "react";
import type { EvalChange, EvalCase } from "../types";

interface Props {
  change: EvalChange;
  index: number;
  selected: boolean;
  onToggle: (index: number) => void;
  originalEval?: EvalCase;
}

const BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  remove: { bg: "var(--red-muted)", color: "var(--red)", label: "REMOVE" },
  modify: { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", label: "MODIFY" },
  add: { bg: "var(--green-muted)", color: "var(--green)", label: "ADD" },
};

const BORDER_COLORS: Record<string, string> = {
  remove: "var(--red)",
  modify: "#fbbf24",
  add: "var(--green)",
};

export function EvalChangeCard({ change, index, selected, onToggle, originalEval }: Props) {
  const [expanded, setExpanded] = useState(false);
  const badge = BADGE_STYLES[change.action] ?? BADGE_STYLES.add;
  const borderColor = BORDER_COLORS[change.action] ?? "var(--border-subtle)";

  const evalName = change.action === "remove"
    ? originalEval?.name ?? `Eval #${change.evalId}`
    : change.eval?.name ?? "Unnamed";

  const handleToggle = useCallback(() => onToggle(index), [onToggle, index]);

  return (
    <div
      className="rounded-lg transition-all duration-150"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
        borderLeft: `3px solid ${borderColor}`,
        opacity: selected ? 1 : 0.5,
      }}
    >
      {/* Summary row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={handleToggle}
          className="flex-shrink-0"
          style={{ accentColor: "var(--accent)" }}
        />
        <span
          className="pill text-[9px] font-bold flex-shrink-0"
          style={{ background: badge.bg, color: badge.color, padding: "1px 6px" }}
        >
          {badge.label}
        </span>
        <span className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {evalName}
        </span>
        <span className="text-[11px] truncate flex-1" style={{ color: "var(--text-tertiary)" }}>
          {change.reason}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors duration-150"
          style={{ color: "var(--text-tertiary)" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s ease" }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          className="px-4 pb-3 animate-fade-in"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          {change.action === "add" && change.eval && (
            <AddDetail evalCase={change.eval} />
          )}
          {change.action === "modify" && change.eval && originalEval && (
            <ModifyDetail original={originalEval} proposed={change.eval} />
          )}
          {change.action === "remove" && originalEval && (
            <RemoveDetail evalCase={originalEval} />
          )}
        </div>
      )}
    </div>
  );
}

function AddDetail({ evalCase }: { evalCase: EvalCase }) {
  return (
    <div className="pt-2.5 space-y-2">
      <Field label="Prompt" value={evalCase.prompt} />
      <Field label="Expected" value={evalCase.expected_output} />
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Assertions ({evalCase.assertions?.length ?? 0})
        </span>
        <div className="mt-1 space-y-1">
          {(evalCase.assertions ?? []).map((a) => (
            <div key={a.id} className="text-[11px] flex items-start gap-1.5" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--green)" }}>+</span> {a.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModifyDetail({ original, proposed }: { original: EvalCase; proposed: EvalCase }) {
  const diffs: Array<{ label: string; old: string; new: string }> = [];

  if (original.name !== proposed.name) {
    diffs.push({ label: "Name", old: original.name, new: proposed.name });
  }
  if (original.prompt !== proposed.prompt) {
    diffs.push({ label: "Prompt", old: original.prompt, new: proposed.prompt });
  }
  if (original.expected_output !== proposed.expected_output) {
    diffs.push({ label: "Expected", old: original.expected_output, new: proposed.expected_output });
  }

  const origAssertions = original.assertions ?? [];
  const propAssertions = proposed.assertions ?? [];
  const oldAssertions = new Set(origAssertions.map((a) => a.text));
  const newAssertions = new Set(propAssertions.map((a) => a.text));
  const added = propAssertions.filter((a) => !oldAssertions.has(a.text));
  const removed = origAssertions.filter((a) => !newAssertions.has(a.text));

  return (
    <div className="pt-2.5 space-y-2">
      {diffs.map((d) => (
        <div key={d.label}>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
            {d.label}
          </span>
          <div className="mt-1 text-[11px] font-mono rounded p-2" style={{ background: "var(--surface-1)" }}>
            <div style={{ color: "var(--red)", textDecoration: "line-through" }}>- {truncate(d.old, 120)}</div>
            <div style={{ color: "var(--green)" }}>+ {truncate(d.new, 120)}</div>
          </div>
        </div>
      ))}
      {(added.length > 0 || removed.length > 0) && (
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
            Assertions
          </span>
          <div className="mt-1 space-y-0.5">
            {removed.map((a) => (
              <div key={a.id} className="text-[11px]" style={{ color: "var(--red)" }}>- {a.text}</div>
            ))}
            {added.map((a) => (
              <div key={a.id} className="text-[11px]" style={{ color: "var(--green)" }}>+ {a.text}</div>
            ))}
          </div>
        </div>
      )}
      {diffs.length === 0 && added.length === 0 && removed.length === 0 && (
        <div className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>No visible field changes</div>
      )}
    </div>
  );
}

function RemoveDetail({ evalCase }: { evalCase: EvalCase }) {
  return (
    <div className="pt-2.5 space-y-2" style={{ opacity: 0.7 }}>
      <Field label="Prompt" value={evalCase.prompt} />
      <div>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Assertions ({evalCase.assertions?.length ?? 0})
        </span>
        <div className="mt-1 space-y-0.5">
          {(evalCase.assertions ?? []).map((a) => (
            <div key={a.id} className="text-[11px]" style={{ color: "var(--red)", textDecoration: "line-through" }}>
              {a.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
        {label}
      </span>
      <div
        className="mt-0.5 text-[11px] p-2 rounded font-mono"
        style={{ background: "var(--surface-1)", color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}
      >
        {truncate(value, 300)}
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
