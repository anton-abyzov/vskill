// 0831 — ProChip: small "Pro" pill rendered next to tier-gated features (US-008).
//
// Owner: desktop-quota-agent.
//
// Two render modes:
//   - "inline"  : renders inline next to a label (e.g. inside a button caption).
//   - "overlay" : absolutely positioned in the corner of a parent container
//                  (used when we want the chip not to disrupt layout).
//
// Tooltip: native `title` for keyboard accessibility (screen readers expose
// title via aria-describedby implicitly). Per AC-US8-06 the copy is
// non-pressuring — no countdowns, no "act now" language.

import type { CSSProperties, ReactElement } from "react";

interface Props {
  /**
   * Tooltip text. Defaults to "Upgrade to enable private repo connections."
   * Override per call site so the chip explains the SPECIFIC feature it's
   * gating.
   */
  tooltip?: string;
  /** "inline" (default) or "overlay". */
  variant?: "inline" | "overlay";
  /** Optional onClick — typically opens the pricing URL via openExternalUrl. */
  onClick?: () => void;
  /** A11y label override. Defaults to "Pro feature — click to learn more". */
  ariaLabel?: string;
}

const DEFAULT_TOOLTIP = "Upgrade to enable private repo connections.";

export function ProChip({
  tooltip = DEFAULT_TOOLTIP,
  variant = "inline",
  onClick,
  ariaLabel = "Pro feature",
}: Props): ReactElement {
  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 6px",
    borderRadius: 9999,
    background: "var(--color-pro-bg, #cb4b16)",
    color: "var(--color-pro-fg, #ffffff)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontFamily: "var(--font-system, -apple-system, system-ui)",
    border: "none",
    cursor: onClick ? "pointer" : "default",
    userSelect: "none",
  };

  const overlayStyle: CSSProperties =
    variant === "overlay"
      ? {
          position: "absolute",
          top: 4,
          right: 4,
          zIndex: 1,
        }
      : {};

  const Element = onClick ? "button" : "span";
  return (
    <Element
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={tooltip}
      aria-label={ariaLabel}
      data-testid="pro-chip"
      data-variant={variant}
      style={{ ...baseStyle, ...overlayStyle }}
    >
      Pro
    </Element>
  );
}
