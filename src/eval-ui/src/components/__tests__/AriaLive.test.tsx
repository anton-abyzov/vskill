// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AriaLive", () => {
  async function render(props: { message: string; politeness?: "polite" | "assertive" }) {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { AriaLive } = await import("../AriaLive");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(React.createElement(AriaLive, props));
    });
    return {
      container,
      rerender(next: typeof props) {
        act(() => root.render(React.createElement(AriaLive, next)));
      },
      unmount() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it("renders with aria-live='polite' by default", async () => {
    const h = await render({ message: "Viewing skill-a" });
    const el = h.container.querySelector("[data-testid='aria-live']")!;
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.getAttribute("role")).toBe("status");
    h.unmount();
  });

  it("uses aria-live='assertive' + role='alert' when politeness='assertive'", async () => {
    const h = await render({ message: "Save failed", politeness: "assertive" });
    const el = h.container.querySelector("[data-testid='aria-live']")!;
    expect(el.getAttribute("aria-live")).toBe("assertive");
    expect(el.getAttribute("role")).toBe("alert");
    h.unmount();
  });

  it("updates its text content when the message prop changes", async () => {
    const h = await render({ message: "first" });
    let el = h.container.querySelector("[data-testid='aria-live']")!;
    expect(el.textContent).toBe("first");
    h.rerender({ message: "second" });
    el = h.container.querySelector("[data-testid='aria-live']")!;
    expect(el.textContent).toBe("second");
    h.unmount();
  });

  it("is visually hidden (sr-only clip)", async () => {
    const h = await render({ message: "hi" });
    const el = h.container.querySelector("[data-testid='aria-live']") as HTMLElement;
    expect(el.style.position).toBe("absolute");
    expect(el.style.width).toBe("1px");
    expect(el.style.height).toBe("1px");
    h.unmount();
  });

  it("sets aria-atomic='true' so the whole message is announced", async () => {
    const h = await render({ message: "hi" });
    const el = h.container.querySelector("[data-testid='aria-live']")!;
    expect(el.getAttribute("aria-atomic")).toBe("true");
    h.unmount();
  });
});
