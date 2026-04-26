// 0741 T-014/T-015: FindSkillsPalette shell.
//
// Lazy-wraps SearchPaletteCore in a Suspense boundary. Manages local `open`
// state. Listens for `window.openFindSkills` (set open=true) and Esc keydown
// (set open=false). When closed, returns null. When open, renders the
// SearchPaletteCore inside a fixed-position dialog overlay.
//
// IMPORTANT — does NOT respond to `openSearch` (that event belongs to the
// existing CommandPalette).
//
// `onSelect` is forwarded into the palette so the caller (App.tsx) can open
// the SkillDetailPanel.

import { lazy, Suspense, useEffect, useRef, useState, useCallback } from "react";
import type { SearchResult } from "./SearchPaletteCore";

const SearchPaletteCore = lazy(() => import("./SearchPaletteCore"));

export interface FindSkillsPaletteProps {
  /** Forwarded into SearchPaletteCore. Fired when a skill row is selected. */
  onSelect?: (result: SearchResult, query: string) => void;
  /** Forwarded into SearchPaletteCore. Default no-op (no router). */
  onNavigate?: (href: string) => void;
}

/** SSR-safe matchMedia probe for prefers-reduced-motion. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function FindSkillsPalette({ onSelect, onNavigate }: FindSkillsPaletteProps = {}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const reducedMotion = prefersReducedMotion();

  // openFindSkills CustomEvent — opens the palette. Optional `detail.query`
  // prefills the input via the inner SearchPaletteCore listener (which also
  // listens for `openFindSkills`).
  useEffect(() => {
    function onOpen() {
      // Capture the trigger so we can restore focus on close (T-030 a11y).
      triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
      setOpen(true);
    }
    window.addEventListener("openFindSkills", onOpen);
    return () => window.removeEventListener("openFindSkills", onOpen);
  }, []);

  // Esc closes the palette. (SearchPaletteCore also handles Esc internally —
  // we keep this listener so the shell unmounts cleanly even if the inner
  // component is mid-suspense.)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus restoration — when the palette closes, refocus the invoking element.
  useEffect(() => {
    if (open) return;
    const trig = triggerRef.current;
    if (trig && typeof trig.focus === "function") {
      try { trig.focus(); } catch { /* focus restoration is best-effort */ }
    }
    triggerRef.current = null;
  }, [open]);

  const handleSelect = useCallback(
    (result: SearchResult, query: string) => {
      // Persist query so the SkillDetailPanel "Back" link can restore it
      // (AC-US4-08, T-026). Wrapped in try/catch because storage access can
      // throw in privacy mode.
      try {
        if (typeof window !== "undefined" && window.sessionStorage) {
          window.sessionStorage.setItem("find-skills:last-query", query ?? "");
        }
      } catch {
        /* storage failure is non-fatal */
      }
      setOpen(false);
      if (onSelect) {
        try { onSelect(result, query); } catch { /* hook failure is non-fatal */ }
      }
    },
    [onSelect],
  );

  if (!open) return null;

  return (
    <div
      data-testid="find-skills-palette-shell"
      data-reduced-motion={reducedMotion ? "true" : "false"}
    >
      <Suspense fallback={null}>
        <SearchPaletteCore
          initialOpen
          onSelect={handleSelect}
          onNavigate={onNavigate}
        />
      </Suspense>
    </div>
  );
}

export default FindSkillsPalette;
