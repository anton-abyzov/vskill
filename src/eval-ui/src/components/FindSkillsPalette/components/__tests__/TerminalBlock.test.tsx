// @vitest-environment jsdom
// 0741 T-007: TerminalBlock port unit tests.
import { describe, it, expect } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: { children: string; compact?: boolean }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { default: TerminalBlock } = await import("../TerminalBlock");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(TerminalBlock, props));
  });
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("TerminalBlock (ported)", () => {
  it("renders children inside a <pre data-testid='terminal-block'>", async () => {
    const h = await render({ children: "vskill install foo" });
    const pre = h.container.querySelector("[data-testid='terminal-block']")!;
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe("vskill install foo");
    h.unmount();
  });

  it("uses compact font/padding when compact=true", async () => {
    const h = await render({ children: "x", compact: true });
    const pre = h.container.querySelector("[data-testid='terminal-block']") as HTMLElement;
    expect(pre.style.fontSize).toBe("0.8rem");
    h.unmount();
  });

  it("uses default font/padding when compact is omitted", async () => {
    const h = await render({ children: "x" });
    const pre = h.container.querySelector("[data-testid='terminal-block']") as HTMLElement;
    expect(pre.style.fontSize).toBe("0.875rem");
    h.unmount();
  });
});
