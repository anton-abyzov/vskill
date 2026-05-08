import { useState, type KeyboardEvent, type MouseEvent } from "react";

// Brand bell color sampled from the canonical orange-bell-badge mark used in
// the hackathon demo video and on verified-skill.com. Inlined here because
// the eval-ui theme tokens (--color-own etc.) resolve to muted clay/wood
// tones, not the saturated mark color.
const BRAND_BELL = "#F25F1C";

// ---------------------------------------------------------------------------
// 0686 T-001 (US-001): StudioLogo — home-link component for the top rail.
//
// Mark: orange notification-bell glyph (transparent SVG) — same identity as
// the prior raster bell-badge but rendered as a tile-less silhouette so it
// reads as a logo glyph next to the wordmark, not as a separate chip. The
// raster asset still exists for social cards / video where a square badge
// is appropriate.
//
// AC coverage:
//   AC-US1-01  Click sets `window.location.hash = "#/"` and invokes the
//              optional `onHome` callback so the parent (App.tsx) can clear
//              any selected skill in StudioContext.
//   AC-US1-02  Renders as an <a href="#/"> with `role="link"` — focusable
//              via Tab, activatable via Enter AND Space (Space is not a
//              default <a> activator, so the keydown handler forces it).
//   AC-US1-03  Visible focus ring (2px solid var(--border-focus)) +
//              `cursor: pointer`. Hover tint is 4% surface, not underline.
//
// The anchor's native click handler is preserved so middle-click / cmd+click
// still work. We prevent the default only for keyboard activation paths
// (Space) and the programmatic hash write (click sets hash explicitly so
// hashchange listeners fire consistently across browsers).
// ---------------------------------------------------------------------------

export interface StudioLogoProps {
  /** Called after the hash is updated to "#/" so the parent can clear any
   *  selected skill in StudioContext. */
  onHome?: () => void;
}

function navigateHome() {
  if (typeof window === "undefined") return;
  // Assign explicitly instead of relying on the <a> default so the value is
  // observable in tests that read window.location.hash immediately after.
  window.location.hash = "#/";
}

export function StudioLogo({ onHome }: StudioLogoProps) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let modifier-clicks (cmd, ctrl, shift, middle button) take default
    // behavior so users can open the home URL in a new tab if they want.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigateHome();
    onHome?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    // Enter on a real anchor activates naturally, but we run the same path
    // to keep the `onHome` callback behavior symmetric and testable under
    // jsdom (which doesn't fire the default click for synthetic events).
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigateHome();
      onHome?.();
    }
  };

  return (
    <a
      href="#/"
      role="link"
      data-testid="studio-logo"
      aria-label="Skill Studio — home"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexShrink: 0,
        padding: "4px 8px",
        margin: "-4px -8px",
        borderRadius: 8,
        textDecoration: "none",
        color: "inherit",
        cursor: "pointer",
        outline: focused ? "2px solid var(--border-focus)" : "none",
        outlineOffset: 2,
        // 4% surface tint on hover. No underline — AC-US1-03 is explicit.
        background: hovered
          ? "color-mix(in srgb, var(--text-primary) 4%, transparent)"
          : "transparent",
        transition:
          "background-color var(--duration-fast, 120ms) var(--ease-standard, ease)",
      }}
    >
      <svg
        width={22}
        height={22}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        style={{ display: "block", flexShrink: 0, overflow: "visible" }}
      >
        {/* Bell silhouette — domed shoulders with a softly flared skirt and
            a rounded clapper. Drawn as one filled path so the glyph stays
            crisp against any surface tint. */}
        <path
          d="M12 3.25c-3.59 0-6.5 2.91-6.5 6.5v3.18c0 .67-.21 1.32-.6 1.86l-1.27 1.78c-.49.69 0 1.65.84 1.65h15.06c.84 0 1.33-.96.84-1.65l-1.27-1.78c-.39-.54-.6-1.19-.6-1.86V9.75c0-3.59-2.91-6.5-6.5-6.5z"
          fill={BRAND_BELL}
        />
        {/* Clapper — half-disc dangling beneath the skirt. */}
        <path
          d="M9.75 19.4h4.5a2.25 2.25 0 11-4.5 0z"
          fill={BRAND_BELL}
        />
        {/* Notification dot — tucked over the bell's right shoulder.
            A subtle stroke in the surface color carves a hairline so the
            dot stays legible when it overlaps the bell. */}
        <circle
          cx="18.5"
          cy="5.5"
          r="2.75"
          fill={BRAND_BELL}
          stroke="var(--surface-base, #ffffff)"
          strokeWidth="1"
        />
      </svg>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          lineHeight: 1,
          color: "var(--text-primary)",
        }}
      >
        Skill Studio
      </span>
    </a>
  );
}
