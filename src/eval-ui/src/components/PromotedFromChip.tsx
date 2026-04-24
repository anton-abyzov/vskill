import type { Provenance } from "../types";

// ---------------------------------------------------------------------------
// 0688 T-021: PromotedFromChip.
//
// Tiny inline chip rendered on OWN-scope rows that were promoted from
// INSTALLED or GLOBAL. Surfaces the source scope as a persistent badge and
// an optional Revert button. The Revert handler is passed in — no direct
// network calls so the chip stays a pure presentation component.
//
// The spec (plan §3.4) calls for a 30s "prominent" window fading to a
// persistent small badge; that transition is delegated to CSS timing on the
// container (parent row controls `data-just-promoted`) so this component
// doesn't hold timers itself.
// ---------------------------------------------------------------------------

export interface PromotedFromChipProps {
  skillName: string;
  provenance: Provenance;
  onRevert?: () => void;
}

export function PromotedFromChip({ skillName, provenance, onRevert }: PromotedFromChipProps) {
  const fromLabel = provenance.promotedFrom; // "installed" | "global"
  return (
    <span
      data-testid="promoted-from-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 3,
        background: "color-mix(in srgb, var(--status-installed) 12%, transparent)",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        flexShrink: 0,
      }}
    >
      <span aria-hidden="true">↑</span>
      <span>promoted from {fromLabel}</span>
      {onRevert && (
        <button
          type="button"
          data-testid="promoted-from-chip-revert"
          aria-label={`Revert ${skillName} to ${fromLabel}`}
          onClick={(e) => {
            e.stopPropagation();
            onRevert();
          }}
          style={{
            marginLeft: 2,
            padding: "1px 4px",
            background: "transparent",
            border: "1px solid var(--border-subtle, #ddd)",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: 10,
            color: "var(--text-secondary)",
          }}
        >
          Revert
        </button>
      )}
    </span>
  );
}
