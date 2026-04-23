// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sidebar — loading placeholder", () => {
  it("renders 6 static placeholder rows when isLoading=true and no shimmer animation", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills: [],
          selectedKey: null,
          onSelect: vi.fn(),
          isLoading: true,
        }),
      );
    });

    const placeholders = container.querySelectorAll(".placeholder");
    // 6 rows × 2 placeholder spans = 12
    expect(placeholders.length).toBeGreaterThanOrEqual(12);

    // Confirm no animation property is applied
    placeholders.forEach((el) => {
      const style = (el as HTMLElement).style.animation;
      expect(style).toBe("");
    });

    // Section headers still render
    expect(container.textContent).not.toContain("shimmer");

    act(() => root.unmount());
    container.remove();
  });
});
