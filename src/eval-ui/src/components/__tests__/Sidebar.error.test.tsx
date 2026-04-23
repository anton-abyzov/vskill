// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Sidebar — error state", () => {
  it("renders error card with message + retry when error prop is set", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const onRetry = vi.fn();
    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills: [],
          selectedKey: null,
          onSelect: vi.fn(),
          error: "Permission denied",
          onRetry,
        }),
      );
    });

    const alert = container.querySelector("[role='alert']");
    expect(alert).toBeTruthy();
    expect(container.textContent).toContain("Permission denied");

    const retry = container.querySelector("button") as HTMLButtonElement;
    expect(retry).toBeTruthy();
    act(() => retry.click());
    expect(onRetry).toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});
