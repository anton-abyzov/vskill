// @vitest-environment jsdom
// 0741 T-007: TrustBadge port unit tests.
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: { tier: "T0" | "T1" | "T2" | "T3" | "T4" }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: TrustBadge } = await import("../TrustBadge");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(TrustBadge, props));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TrustBadge (ported from vskill-platform)", () => {
  it("renders T0 with BLOCKED label", async () => {
    const h = await render({ tier: "T0" });
    const el = h.container.querySelector("[data-testid='trust-badge']")!;
    expect(el.textContent).toContain("T0");
    expect(el.textContent).toContain("BLOCKED");
    expect(el.getAttribute("data-tier")).toBe("T0");
    h.unmount();
  });

  it("renders T1 with UNSCANNED label", async () => {
    const h = await render({ tier: "T1" });
    const el = h.container.querySelector("[data-testid='trust-badge']")!;
    expect(el.textContent).toContain("UNSCANNED");
    h.unmount();
  });

  it("renders T2 with BASIC label", async () => {
    const h = await render({ tier: "T2" });
    expect(h.container.textContent).toContain("BASIC");
    h.unmount();
  });

  it("renders T3 with VERIFIED label", async () => {
    const h = await render({ tier: "T3" });
    expect(h.container.textContent).toContain("VERIFIED");
    h.unmount();
  });

  it("renders T4 with CERTIFIED label", async () => {
    const h = await render({ tier: "T4" });
    expect(h.container.textContent).toContain("CERTIFIED");
    h.unmount();
  });
});
