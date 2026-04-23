import { useState, type KeyboardEvent, type MouseEvent } from "react";

// ---------------------------------------------------------------------------
// 0686 T-001 (US-001): StudioLogo — home-link component for the top rail.
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
        gap: 10,
        flexShrink: 0,
        padding: "4px 6px",
        margin: "-4px -6px",
        borderRadius: 6,
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
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          background: "color-mix(in srgb, var(--accent-surface) 20%, transparent)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--accent-surface)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--text-primary)",
        }}
      >
        Skill Studio
      </span>
    </a>
  );
}
