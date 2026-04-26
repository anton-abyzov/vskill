// 0741 T-017/T-018: FindSkillsNavButton — TopRail entry-point for the
// FindSkillsPalette (⌘⇧K).
//
// Click → dispatches `window.dispatchEvent(new CustomEvent("openFindSkills"))`.
// Renders a shortcut-hint badge: "⌘⇧K" on Mac, "Ctrl+Shift+K" otherwise.
// Platform detection uses `navigator.platform` (SSR-safe via useEffect).
// Under prefers-reduced-motion: reduce, no pulse animation applies.
//
// Differs from vskill-platform/src/app/studio/components/FindNavButton.tsx
// by using the ⌘⇧K shortcut (not bare ⌘K) and the `openFindSkills` event
// (not `openSearch`) — both kept distinct so existing CommandPalette
// bindings remain unchanged.

import { useEffect, useState } from "react";

function detectMacShortcut(): "⌘⇧K" | "Ctrl+Shift+K" {
  if (typeof navigator === "undefined") return "⌘⇧K";
  const platform = navigator.platform?.toUpperCase() ?? "";
  const ua = navigator.userAgent?.toUpperCase() ?? "";
  const isMac = platform.includes("MAC") || ua.includes("MAC");
  return isMac ? "⌘⇧K" : "Ctrl+Shift+K";
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function FindSkillsNavButton() {
  // SSR-safe default — Mac glyph wins on the server, useEffect below
  // upgrades to Ctrl+Shift+K on Win/Linux. Either label satisfies AC-US2-03.
  const [shortcut, setShortcut] = useState<"⌘⇧K" | "Ctrl+Shift+K">("⌘⇧K");
  useEffect(() => {
    setShortcut(detectMacShortcut());
  }, []);

  const reducedMotion = prefersReducedMotion();

  function handleClick() {
    // Fire the custom event the FindSkillsPalette listens for — no payload
    // (palette opens with empty query so the user can start typing).
    window.dispatchEvent(new CustomEvent("openFindSkills"));
  }

  // Match the existing TopRail "+ New Skill" sibling chrome (height 28,
  // padding 0 12px, fontSize 12, var(--font-sans)). Subdued colors so
  // the primary CTA next to it (New Skill) stays visually dominant.
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Find verified skills — opens search (${shortcut})`}
      title={`Find verified skills (${shortcut})`}
      data-testid="find-skills-nav-button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 12px",
        borderRadius: 6,
        border: "1px solid var(--border-default)",
        background: "transparent",
        color: "var(--text-secondary)",
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
        letterSpacing: "0.01em",
      }}
    >
      <svg
        data-icon="search"
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>Find skills</span>
      <kbd
        data-animated={reducedMotion ? "false" : "true"}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-faint)",
          border: "1px solid var(--border-default)",
          borderRadius: 4,
          padding: "1px 5px",
          marginLeft: 2,
          lineHeight: 1,
        }}
      >
        {shortcut}
      </kbd>
    </button>
  );
}

export default FindSkillsNavButton;
