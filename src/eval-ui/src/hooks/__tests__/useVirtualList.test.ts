// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0682 F-005 — useVirtualList unit tests.
//
// Exercises the windowing math and the threshold gate that decides whether
// virtualisation kicks in. Renders a tiny test harness component that
// exposes the hook's return value via a ref so we can assert on it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { useVirtualList, type VirtualListResult } from "../useVirtualList";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_HEIGHT = 44;
const VIEWPORT = 352; // 8 rows

interface HarnessProps {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  opts?: Parameters<typeof useVirtualList>[3];
  capture: (v: VirtualListResult) => void;
}

async function renderHookOnce(props: HarnessProps): Promise<VirtualListResult> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  let captured: VirtualListResult | null = null;
  const Harness: React.FC<HarnessProps> = (p) => {
    const v = useVirtualList(p.itemCount, p.rowHeight, p.viewportHeight, p.opts);
    p.capture(v);
    captured = v;
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness, props));
  });
  return captured!;
}

describe("useVirtualList — virtualisation threshold", () => {
  it("returns virtualised: false when itemCount < threshold", async () => {
    const v = await renderHookOnce({
      itemCount: 20, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(v.virtualised).toBe(false);
    expect(v.visibleStart).toBe(0);
    expect(v.visibleEnd).toBe(20);
  });

  it("returns virtualised: true at the default 80-item threshold", async () => {
    const v = await renderHookOnce({
      itemCount: 80, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(v.virtualised).toBe(true);
  });

  it("respects a custom threshold opt", async () => {
    const v = await renderHookOnce({
      itemCount: 50, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      opts: { threshold: 30 },
      capture: () => {},
    });
    expect(v.virtualised).toBe(true);
  });
});

describe("useVirtualList — windowing math", () => {
  it("at scrollTop=0 with default buffer, visibleEnd ≈ rowsInViewport + buffer*2", async () => {
    const v = await renderHookOnce({
      itemCount: 200, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      opts: { buffer: 4 },
      capture: () => {},
    });
    expect(v.virtualised).toBe(true);
    expect(v.visibleStart).toBe(0);
    const expectedEnd = Math.ceil(VIEWPORT / ROW_HEIGHT) + 4 * 2;
    expect(v.visibleEnd).toBe(expectedEnd);
  });

  it("computes totalHeight as itemCount * rowHeight", async () => {
    const v = await renderHookOnce({
      itemCount: 200, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(v.totalHeight).toBe(200 * ROW_HEIGHT);
  });
});

describe("useVirtualList — container props", () => {
  it("exposes onScroll, ref, and viewport-bound style", async () => {
    const v = await renderHookOnce({
      itemCount: 100, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(typeof v.containerProps.onScroll).toBe("function");
    expect(v.containerProps.ref).toBeDefined();
    expect(v.containerProps.style.maxHeight).toBe(VIEWPORT);
    expect(v.containerProps.style.overflowY).toBe("auto");
  });

  it("only sets willChange: 'transform' when virtualising", async () => {
    const small = await renderHookOnce({
      itemCount: 10, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(small.containerProps.style.willChange).toBeUndefined();
    const big = await renderHookOnce({
      itemCount: 200, rowHeight: ROW_HEIGHT, viewportHeight: VIEWPORT,
      capture: () => {},
    });
    expect(big.containerProps.style.willChange).toBe("transform");
  });
});
