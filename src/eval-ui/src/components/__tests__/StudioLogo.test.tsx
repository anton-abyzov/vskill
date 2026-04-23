// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-001: StudioLogo — home-nav component.
//
// Covers AC-US1-01 / AC-US1-02 / AC-US1-03:
//   - Clicking clears selected skill AND sets hash to "#/".
//   - Renders as <a href="#/"> with role="link", focusable via Tab,
//     activatable via Enter AND Space.
//   - Focus-visible outline uses var(--border-focus).
// ---------------------------------------------------------------------------

describe("0686 T-001: StudioLogo", () => {
  beforeEach(() => {
    window.location.hash = "#/detail/foo/bar";
  });

  it("renders as an anchor with role=link, href=#/ and the 'Skill Studio' name", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioLogo } = await import("../StudioLogo");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(StudioLogo, { onHome: vi.fn() }));
    });

    const anchor = container.querySelector("a[data-testid='studio-logo']") as HTMLAnchorElement;
    expect(anchor).toBeTruthy();
    expect(anchor.getAttribute("href")).toBe("#/");
    // Native <a> has implicit role=link, but we force it explicitly per AC.
    expect(anchor.getAttribute("role")).toBe("link");
    expect(anchor.textContent).toContain("Skill Studio");

    act(() => root.unmount());
    container.remove();
  });

  it("click sets window.location.hash to '#/' and invokes onHome to clear selection", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioLogo } = await import("../StudioLogo");

    const onHome = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(StudioLogo, { onHome }));
    });

    const anchor = container.querySelector("a[data-testid='studio-logo']") as HTMLAnchorElement;
    act(() => anchor.click());

    expect(window.location.hash).toBe("#/");
    expect(onHome).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it("Enter and Space key activation both navigate to '#/' (keyboard semantics)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioLogo } = await import("../StudioLogo");

    const onHome = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(StudioLogo, { onHome }));
    });

    const anchor = container.querySelector("a[data-testid='studio-logo']") as HTMLAnchorElement;

    // Enter
    window.location.hash = "#/detail/a/b";
    act(() => {
      anchor.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    expect(window.location.hash).toBe("#/");

    // Space (native <a> does NOT activate on Space; our onKeyDown handler must).
    window.location.hash = "#/detail/a/b";
    act(() => {
      anchor.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
    });
    expect(window.location.hash).toBe("#/");
    expect(onHome).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    container.remove();
  });

  it("applies a focus outline using var(--border-focus) (AC-US1-03)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioLogo } = await import("../StudioLogo");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(StudioLogo, { onHome: vi.fn() }));
    });

    const anchor = container.querySelector("a[data-testid='studio-logo']") as HTMLAnchorElement;
    act(() => {
      anchor.focus();
      anchor.dispatchEvent(new FocusEvent("focus"));
    });
    // Outline updated via inline style on focus.
    expect(anchor.style.outline).toContain("var(--border-focus)");
    // Cursor pointer per AC-US1-03.
    expect(anchor.style.cursor).toBe("pointer");

    act(() => root.unmount());
    container.remove();
  });
});
