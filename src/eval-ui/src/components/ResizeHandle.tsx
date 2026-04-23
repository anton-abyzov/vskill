import { useEffect, useRef } from "react";

export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 480;
export const SIDEBAR_WIDTH_KEY = "vskill-sidebar-width";
export const DEFAULT_SIDEBAR_WIDTH = 320;

export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, px)));
}

export function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_WIDTH;
    return clampSidebarWidth(n);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

export function writeSidebarWidth(px: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(px)));
  } catch {
    /* ignore */
  }
}

interface Props {
  /** Current width in px (px of sidebar, not of this handle). */
  initialWidth: number;
  /** Fired during drag (throttled by requestAnimationFrame in browsers). */
  onChange: (widthPx: number) => void;
}

/**
 * 4px-wide vertical splitter. Pointer-capture based drag: `pointerdown`
 * on the handle starts a drag, `pointermove` reports clamped widths,
 * `pointerup` persists the final value to localStorage.
 *
 * `cursor: col-resize`. No transition during drag — value feedback is live.
 * Accessible role="separator" with aria-valuemin/max/now for screen readers.
 */
export function ResizeHandle({ initialWidth, onChange }: Props) {
  const state = useRef<{ startX: number; startWidth: number; pointerId: number | null }>({
    startX: 0,
    startWidth: initialWidth,
    pointerId: null,
  });
  const widthRef = useRef<number>(initialWidth);

  useEffect(() => {
    widthRef.current = initialWidth;
  }, [initialWidth]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (state.current.pointerId == null || e.pointerId !== state.current.pointerId) return;
      const delta = e.clientX - state.current.startX;
      const next = clampSidebarWidth(state.current.startWidth + delta);
      widthRef.current = next;
      onChange(next);
    }
    function onUp(e: PointerEvent) {
      if (state.current.pointerId == null || e.pointerId !== state.current.pointerId) return;
      state.current.pointerId = null;
      writeSidebarWidth(widthRef.current);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onChange]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={initialWidth}
      aria-label="Resize sidebar"
      title="Drag to resize sidebar"
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLDivElement & {
          setPointerCapture: (id: number) => void;
        };
        state.current.startX = e.clientX;
        state.current.startWidth = widthRef.current;
        state.current.pointerId = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
      style={{
        width: 4,
        alignSelf: "stretch",
        cursor: "col-resize",
        background: "var(--border-default)",
        userSelect: "none",
        touchAction: "none",
      }}
    />
  );
}
