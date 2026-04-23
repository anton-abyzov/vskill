// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DisconnectBanner", () => {
  it("renders nothing when connected=true", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { DisconnectBanner } = await import("../DisconnectBanner");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(DisconnectBanner, { connected: true }));
    });

    expect(container.textContent).toBe("");

    act(() => root.unmount());
    container.remove();
  });

  it("renders 'Disconnected — reconnecting…' when connected=false", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { DisconnectBanner } = await import("../DisconnectBanner");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(DisconnectBanner, { connected: false }));
    });

    expect(container.textContent).toContain("Disconnected");
    expect(container.textContent).toContain("reconnecting");

    const aside = container.querySelector("aside[aria-live='assertive']");
    expect(aside).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });
});
