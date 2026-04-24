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
  /** Optional primary action rendered on the right side (e.g. "+ Create"). */
  action?: {
    label: string;
    title?: string;
    onClick: () => void;
    icon?: React.ReactNode;
  };
}

export function GroupHeader({
  name,
  count,
  className,
  variant,
  collapsed,
  onToggle,
  action,
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
            fontSize: 15,
            fontWeight: 700,
            color: accent,
            width: 16,
            display: "inline-block",
            textAlign: "center",
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
      {action && (
        <span style={{ marginLeft: "auto" }}>
          <ActionButton
            label={action.label}
            title={action.title}
            icon={action.icon}
            onClick={action.onClick}
            accent={accent}
          />
        </span>
      )}
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

// ActionButton renders as a visible-on-hover secondary affordance inside the
// group header. Stops click propagation so clicking "+" doesn't collapse the
// group.
function ActionButton({
  label,
  title,
  icon,
  onClick,
  accent,
}: {
  label: string;
  title?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  accent: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        height: 22,
        padding: "0 7px",
        border: `1px solid ${accent}`,
        background: "transparent",
        color: accent,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `color-mix(in oklch, ${accent} 15%, transparent)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {icon}
      {label}
    </button>
  );
}
