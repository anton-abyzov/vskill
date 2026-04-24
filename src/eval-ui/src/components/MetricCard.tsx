import type { ReactNode, KeyboardEvent } from "react";

// ---------------------------------------------------------------------------
// T-001 (0707): Ported from vskill-platform/src/app/components/MetricCard.tsx
//
// A compact metric card used by SkillOverview's responsive grid. Preserves
// the public portal design language (mono labels, large tabular value,
// optional description / subtitle / linkLabel footer) using the same CSS
// variables already defined in globals.css.
//
// The portal MetricCard accepted an `href` (anchor). For Skill Studio we
// want click-to-navigate-tab behavior, so we accept an `onClick` instead —
// when present the card renders as role="button" with tabIndex=0 and
// Enter/Space activates the callback.
// ---------------------------------------------------------------------------

export interface MetricCardProps {
  /** Uppercase mono label (e.g. "Tests"). */
  title?: string;
  /** Portal-compat alias for `title`. */
  label?: string;
  /** Large value string — numbers coerced via String(). */
  value: string | number;
  /** Optional subtitle shown under the value in mono. */
  subtitle?: string;
  /** Longer descriptive line (muted). */
  description?: string;
  /** Optional footer row label (e.g. "View run ↗"). */
  linkLabel?: string;
  /** Extra content slotted between description and footer. */
  children?: ReactNode;
  /** When set, the card becomes a keyboard-activatable button. */
  onClick?: () => void;
  /** Optional deterministic test id. */
  "data-testid"?: string;
}

export function MetricCard(props: MetricCardProps) {
  const { title, label, value, subtitle, description, linkLabel, children, onClick } = props;
  const heading = title ?? label ?? "";
  const clickable = typeof onClick === "function";

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      className={clickable ? "metric-card metric-card-link" : "metric-card"}
      data-testid={props["data-testid"]}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onClick?.() : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      style={{
        background: "var(--card-bg, var(--bg-surface))",
        border: "1px solid var(--border, var(--border-default))",
        borderRadius: 6,
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        minWidth: 0,
        height: "100%",
        cursor: clickable ? "pointer" : undefined,
        wordBreak: "break-word",
        overflowWrap: "anywhere",
      }}
    >
      {heading ? (
        <div
          data-testid={props["data-testid"] ? `${props["data-testid"]}-title` : undefined}
          style={{
            fontFamily: "var(--font-geist-mono, var(--font-mono))",
            fontSize: "0.5625rem",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--card-text-muted, var(--text-secondary))",
          }}
        >
          {heading}
        </div>
      ) : null}
      <div
        data-testid={props["data-testid"] ? `${props["data-testid"]}-value` : undefined}
        style={{
          fontFamily: "var(--font-geist-mono, var(--font-mono))",
          fontSize: "1.375rem",
          fontWeight: 700,
          color: "var(--card-text, var(--text-primary))",
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {String(value)}
      </div>
      {subtitle ? (
        <div
          style={{
            fontFamily: "var(--font-geist-mono, var(--font-mono))",
            fontSize: "0.625rem",
            color: "var(--card-text-muted, var(--text-secondary))",
          }}
        >
          {subtitle}
        </div>
      ) : null}
      {description ? (
        <div
          style={{
            fontFamily: "var(--font-geist-mono, var(--font-mono))",
            fontSize: "0.5625rem",
            color: "var(--card-text-muted, var(--text-secondary))",
            lineHeight: 1.4,
            opacity: 0.7,
          }}
        >
          {description}
        </div>
      ) : null}
      {children ? (
        <div style={{ flex: 1, marginTop: "0.25rem" }}>{children}</div>
      ) : null}
      {linkLabel ? (
        <div
          style={{
            marginTop: "auto",
            paddingTop: "0.375rem",
            borderTop: "1px solid var(--border, var(--border-default))",
            fontFamily: "var(--font-geist-mono, var(--font-mono))",
            fontSize: "0.625rem",
            color: "var(--card-text-muted, var(--text-secondary))",
          }}
        >
          {linkLabel}
        </div>
      ) : null}
    </div>
  );
}

export default MetricCard;
