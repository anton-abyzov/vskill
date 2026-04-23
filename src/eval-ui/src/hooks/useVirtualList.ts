// ---------------------------------------------------------------------------
// useVirtualList — tiny fixed-height virtualiser (no lib dep).
//
// Returns the slice of indices currently visible + scroll handlers. Consumer
// renders only items within `visibleStart..visibleEnd` and pads the list
// container with a spacer div to preserve total scroll height.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState, type UIEvent } from "react";

export interface VirtualListResult {
  visibleStart: number;
  visibleEnd: number;
  totalHeight: number;
  offsetTop: number;
  containerProps: {
    onScroll: (e: UIEvent<HTMLDivElement>) => void;
    ref: React.RefObject<HTMLDivElement | null>;
    style: React.CSSProperties;
  };
  virtualised: boolean;
}

export function useVirtualList(
  itemCount: number,
  rowHeight: number,
  viewportHeight: number,
  opts?: { buffer?: number; threshold?: number },
): VirtualListResult {
  const buffer = opts?.buffer ?? 4;
  const threshold = opts?.threshold ?? 80;
  const virtualised = itemCount >= threshold;

  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  }, []);

  const { visibleStart, visibleEnd } = useMemo(() => {
    if (!virtualised) return { visibleStart: 0, visibleEnd: itemCount };
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + buffer * 2;
    const last = Math.min(itemCount, first + visibleCount);
    return { visibleStart: first, visibleEnd: last };
  }, [virtualised, scrollTop, rowHeight, viewportHeight, itemCount, buffer]);

  return {
    visibleStart,
    visibleEnd,
    totalHeight: itemCount * rowHeight,
    offsetTop: visibleStart * rowHeight,
    virtualised,
    containerProps: {
      onScroll: handleScroll,
      ref,
      style: {
        overflowY: "auto",
        maxHeight: viewportHeight,
        willChange: virtualised ? "transform" : undefined,
      },
    },
  };
}
