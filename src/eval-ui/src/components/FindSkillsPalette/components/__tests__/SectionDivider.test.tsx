// @vitest-environment jsdom
// 0741 T-007: SectionDivider port unit tests.
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(title: string) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: SectionDivider } = await import("../SectionDivider");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(SectionDivider, { title }));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("SectionDivider (ported)", () => {
  it("renders the title prefixed with '── '", async () => {
    const h = await render("Versions");
    const el = h.container.querySelector("[data-testid='section-divider']")!;
    expect(el.textContent).toContain("── ");
    expect(el.textContent).toContain("Versions");
    h.unmount();
  });

  it("pads short titles with trailing dashes (terminal feel)", async () => {
    const h = await render("X");
    const el = h.container.querySelector("[data-testid='section-divider']")!;
    // 48 - len("X") = 47 trailing dashes
    expect((el.textContent ?? "").match(/─/g)?.length).toBeGreaterThan(40);
    h.unmount();
  });

  it("does NOT pad below zero for very long titles", async () => {
    const longTitle = "X".repeat(60);
    const h = await render(longTitle);
    const el = h.container.querySelector("[data-testid='section-divider']")!;
    expect(el.textContent).toContain(longTitle);
    h.unmount();
  });
});
