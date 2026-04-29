import { useState, type KeyboardEvent, type MouseEvent } from "react";
import skillStudioLogoUrl from "../assets/skill-studio-logo.png";

// ---------------------------------------------------------------------------
// 0686 T-001 (US-001): StudioLogo — home-link component for the top rail.
//
// Mark: bell-badge "Skill Studio" logo (v6-A-orange-bell-badge.png) — the
// canonical mark used in the hackathon demo video and on verified-skill.com.
// Replaces the prior inline heartbeat-polyline SVG so every Skill Studio
// surface shows the same orange bell mark.
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
      <img
        src={skillStudioLogoUrl}
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        style={{
          display: "block",
          objectFit: "contain",
          flexShrink: 0,
        }}
      />
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
