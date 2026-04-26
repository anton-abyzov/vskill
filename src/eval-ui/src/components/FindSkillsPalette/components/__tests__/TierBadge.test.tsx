// @vitest-environment jsdom
// 0741 T-007: TierBadge port unit tests.
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: { tier: "VERIFIED" | "CERTIFIED"; size?: "sm" | "md" | "lg"; isTainted?: boolean }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: TierBadge } = await import("../TierBadge");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(TierBadge, props));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TierBadge (ported)", () => {
  it("renders VERIFIED with the 'Security-Scanned' label", async () => {
    const h = await render({ tier: "VERIFIED" });
    const el = h.container.querySelector("[data-testid='tier-badge']")!;
    expect(el.textContent).toContain("Security-Scanned");
    expect(el.getAttribute("data-tier")).toBe("VERIFIED");
    h.unmount();
  });

  it("renders CERTIFIED with the 'Trusted Publisher' label", async () => {
    const h = await render({ tier: "CERTIFIED" });
    const el = h.container.querySelector("[data-testid='tier-badge']")!;
    expect(el.textContent).toContain("Trusted Publisher");
    expect(el.getAttribute("data-tier")).toBe("CERTIFIED");
    h.unmount();
  });

  it("renders TAINTED label when isTainted=true (overrides tier)", async () => {
    const h = await render({ tier: "VERIFIED", isTainted: true });
    const el = h.container.querySelector("[data-testid='tier-badge']")!;
    expect(el.textContent).toContain("Tainted");
    expect(el.getAttribute("data-tier")).toBe("TAINTED");
    h.unmount();
  });

  it("supports the 'sm' size variant", async () => {
    const h = await render({ tier: "VERIFIED", size: "sm" });
    const el = h.container.querySelector("[data-testid='tier-badge']") as HTMLElement;
    expect(el.style.height).toBe("18px");
    h.unmount();
  });

  it("supports the 'lg' size variant", async () => {
    const h = await render({ tier: "VERIFIED", size: "lg" });
    const el = h.container.querySelector("[data-testid='tier-badge']") as HTMLElement;
    expect(el.style.height).toBe("26px");
    h.unmount();
  });

  it("renders an SVG icon (aria-hidden, decorative)", async () => {
    const h = await render({ tier: "VERIFIED" });
    const svg = h.container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    h.unmount();
  });
});

describe("formatTierLabel (ported)", () => {
  it("maps tier codes to display labels", async () => {
    const { formatTierLabel } = await import("../TierBadge");
    expect(formatTierLabel("VERIFIED")).toBe("Security-Scanned");
    expect(formatTierLabel("CERTIFIED")).toBe("Trusted Publisher");
    expect(formatTierLabel("TAINTED")).toBe("Tainted");
    expect(formatTierLabel("UNKNOWN")).toBe("UNKNOWN");
  });
});
