// ---------------------------------------------------------------------------
// 0698 T-008: GroupHeader
//
// Sticky + collapsible header for the AVAILABLE / AUTHORING top-level groups.
// Stays visible while scrolling so the user always knows which category the
// current sub-section belongs to. Clicking toggles collapse; state persists
// via `storageKey` when provided.
//
// High-contrast treatment: bold serif label, accent left border, subtle
// tinted background. Variant differentiates AVAILABLE (accent blue) from
// AUTHORING (amber) so the two groups are instantly distinguishable.
// ---------------------------------------------------------------------------

import * as React from "react";

export interface GroupHeaderProps {
  name: string;
  count: number;
  className?: string;
  variant?: "available" | "authoring";
  /** Controlled collapsed state. If undefined, the header is non-interactive. */
  collapsed?: boolean;
  /** Click handler — receives the next collapsed value. */
  onToggle?: (next: boolean) => void;
}

export function GroupHeader({
  name,
  count,
  className,
  variant,
  collapsed,
  onToggle,
}: GroupHeaderProps): React.ReactElement {
  const accent =
    variant === "authoring"
      ? "var(--color-own, #f59e0b)"
      : "var(--color-accent, #2f6f8f)";
  const tint =
    variant === "authoring"
      ? "color-mix(in oklch, var(--color-own, #f59e0b) 10%, var(--color-paper, #fff))"
      : "color-mix(in oklch, var(--color-accent, #2f6f8f) 8%, var(--color-paper, #fff))";

  const interactive = typeof onToggle === "function";

  const containerStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 4,
    backdropFilter: "saturate(1.4) blur(10px)",
    WebkitBackdropFilter: "saturate(1.4) blur(10px)",
    background: tint,
    borderLeft: `3px solid ${accent}`,
    borderBottom: "1px solid var(--border-subtle, rgba(128,128,128,0.2))",
    padding: "7px 10px 7px 9px",
    fontFamily: "var(--font-serif, ui-serif)",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    cursor: interactive ? "pointer" : "default",
    border: "none",
    textAlign: "left" as const,
  };

  const chevron = collapsed ? "▸" : "▾";

  const inner = (
    <>
      {interactive && (
        <span
          aria-hidden
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            width: 10,
            display: "inline-block",
            letterSpacing: 0,
            textTransform: "none",
          }}
        >
          {chevron}
        </span>
      )}
      <span className="vskill-group-header-name">{name}</span>
      <span
        className="vskill-group-header-count tabular-nums"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-secondary)",
          letterSpacing: 0,
          textTransform: "none",
        }}
      >
        ({count})
      </span>
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        data-vskill-group-header={name}
        className={["vskill-group-header select-none", className ?? ""].join(" ").trim()}
        style={containerStyle}
        onClick={() => onToggle!(!collapsed)}
        aria-expanded={!collapsed}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      data-vskill-group-header={name}
      role="heading"
      aria-level={3}
      className={["vskill-group-header select-none", className ?? ""].join(" ").trim()}
      style={containerStyle}
    >
      {inner}
    </div>
  );
}
