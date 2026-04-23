// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { clampSidebarWidth, readSidebarWidth, writeSidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, SIDEBAR_WIDTH_KEY } from "../ResizeHandle";

describe("ResizeHandle helpers", () => {
  beforeEach(() => localStorage.clear());

  it("clamps width to [MIN, MAX]", () => {
    expect(clampSidebarWidth(0)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(100)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
    expect(MIN_SIDEBAR_WIDTH).toBe(240);
    expect(MAX_SIDEBAR_WIDTH).toBe(480);
  });

  it("reads width from localStorage with fallback", () => {
    expect(readSidebarWidth()).toBe(320);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "360");
    expect(readSidebarWidth()).toBe(360);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, "not-a-number");
    expect(readSidebarWidth()).toBe(320);
  });

  it("writes clamped width to localStorage", () => {
    writeSidebarWidth(999);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(MAX_SIDEBAR_WIDTH));
    writeSidebarWidth(150);
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe(String(MIN_SIDEBAR_WIDTH));
  });
});

// Polyfill PointerEvent for jsdom.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (globalThis as { PointerEvent?: unknown }).PointerEvent = FakePointerEvent as unknown;
}

describe("ResizeHandle component", () => {
  beforeEach(() => localStorage.clear());

  it("reports width via onChange when dragged (pointer move)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ResizeHandle } = await import("../ResizeHandle");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onChange = vi.fn();
    act(() => {
      root.render(
        React.createElement(ResizeHandle, {
          initialWidth: 320,
          onChange,
        }),
      );
    });

    const handle = container.querySelector("[role='separator']") as HTMLElement;
    expect(handle).toBeTruthy();

    // Fake setPointerCapture since jsdom lacks it
    (handle as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
    (handle as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture = () => {};

    act(() => {
      handle.dispatchEvent(
        new PointerEvent("pointerdown", { clientX: 320, pointerId: 1, bubbles: true }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 370, pointerId: 1, bubbles: true }),
      );
    });

    expect(onChange).toHaveBeenCalledWith(370);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 370, pointerId: 1, bubbles: true }));
    });
    expect(localStorage.getItem(SIDEBAR_WIDTH_KEY)).toBe("370");

    act(() => root.unmount());
    container.remove();
  });
});
