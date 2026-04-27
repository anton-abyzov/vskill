// ---------------------------------------------------------------------------
// 0774 T-001: SubTabBar — secondary tab bar nested under a top-level
// RightPanel tab.
//
// 0792 T-015/T-016: visibility + safety pass.
// - Inactive tabs use a non-transparent border-bottom and 13px font so the
//   bar reads as clickable. Hover state lifts background + flips cursor.
// - The default `onChange` fires `console.warn` in dev so a missing handler
//   surfaces instead of silently swallowing the click.
// ---------------------------------------------------------------------------

import { useState } from "react";

export interface SubTabDescriptor {
  id: string;
  label: string;
}

export interface SubTabBarProps {
  /** Tab descriptors — order is render order. */
  tabs: SubTabDescriptor[];
  /** Currently active sub-tab id. */
  active: string;
  /** Fires when the user clicks a sub-tab. */
  onChange?: (id: string) => void;
  /** ID of the parent top-level tab (e.g. "run", "history"). Used to scope
   *  data-testid attributes so component tests can address sub-tabs uniquely
   *  even when two SubTabBars exist in the tree. */
  parentTabId: string;
}

// 0792 T-016: replaces the prior silent no-op default. In dev builds a
// missing `onChange` handler is logged so the previously-latent silent
// breakage is observable.
function defaultSubChange(parentTabId: string, id: string): void {
  if (typeof process !== "undefined" && process?.env?.NODE_ENV === "production") {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[SubTabBar] sub-tab "${id}" clicked under "${parentTabId}" but no onChange handler was wired. ` +
      `Pass an onChange prop or this click is a no-op.`,
  );
}

export function SubTabBar({ tabs, active, onChange, parentTabId }: SubTabBarProps) {
  // 0792 T-015: track hover so we can flip the background color on the
  // hovered (inactive) tab — purely visual reinforcement that the bar is
  // clickable.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const handleChange = (id: string) => {
    if (onChange) onChange(id);
    else defaultSubChange(parentTabId, id);
  };

  return (
    <div
      role="tablist"
      aria-label={`${parentTabId} sub-sections`}
      data-testid={`detail-subtab-bar-${parentTabId}`}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 2,
        // 0792 AC-US2-01: non-transparent bottom border so the bar reads as
        // a real surface rather than blending into the canvas.
        borderBottom: "1px solid var(--border-subtle, var(--border-default))",
        padding: "0 16px",
        background: "var(--bg-canvas)",
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        const isHovered = hoveredId === t.id && !isActive;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            id={`detail-subtab-${parentTabId}-${t.id}`}
            data-testid={`detail-subtab-${parentTabId}-${t.id}`}
            onClick={() => handleChange(t.id)}
            onMouseEnter={() => setHoveredId(t.id)}
            onMouseLeave={() => setHoveredId((cur) => (cur === t.id ? null : cur))}
            style={{
              // 0792 AC-US2-01: hovered inactive tabs surface a distinct
              // background so the affordance is visible even before click.
              background: isHovered ? "var(--surface-2, rgba(0,0,0,0.04))" : "transparent",
              border: "none",
              borderBottom: isActive
                ? "2px solid var(--text-primary)"
                // Inactive border uses a visible (non-transparent) subtle line
                // so the row reads as a clickable bar.
                : "2px solid var(--border-subtle, transparent)",
              padding: "8px 10px",
              marginBottom: -1,
              fontFamily: "var(--font-sans)",
              // 0792 AC-US2-01: 13px font satisfies "≥13px" requirement.
              fontSize: 13,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 80ms ease",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
