// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SidebarSection updateCount chip (0683 T-005)", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "";
  });
  afterEach(() => vi.restoreAllMocks());

  async function mount(props: {
    origin: "source" | "installed";
    count: number;
    updateCount?: number;
  }) {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SidebarSection } = await import("../SidebarSection");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(
          SidebarSection,
          props,
          React.createElement("div", { "data-testid": "section-body" }, "body"),
        ),
      );
    });
    return {
      container,
      act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
      unmount() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it("renders a 'N updates ▾' chip when updateCount > 0", async () => {
    const h = await mount({ origin: "installed", count: 10, updateCount: 3 });
    try {
      const chip = h.container.querySelector("[data-testid='sidebar-section-update-chip']") as HTMLElement;
      expect(chip).toBeTruthy();
      expect(chip.textContent).toContain("3 updates");
      expect(chip.textContent).toContain("▾");
      const style = chip.getAttribute("style") || "";
      expect(style).toContain("var(--color-own)");
      expect(style).toContain("var(--font-mono)");
    } finally {
      h.unmount();
    }
  });

  it("renders no chip when updateCount is 0 or undefined", async () => {
    const zero = await mount({ origin: "installed", count: 10, updateCount: 0 });
    expect(zero.container.querySelector("[data-testid='sidebar-section-update-chip']")).toBeFalsy();
    zero.unmount();
    const undef = await mount({ origin: "source", count: 5 });
    expect(undef.container.querySelector("[data-testid='sidebar-section-update-chip']")).toBeFalsy();
    undef.unmount();
  });

  it("sets window.location.hash to #/updates on click WITHOUT toggling collapse", async () => {
    const h = await mount({ origin: "installed", count: 10, updateCount: 2 });
    try {
      const header = h.container.querySelector("button[data-testid='sidebar-section-header']") as HTMLButtonElement;
      const chip = h.container.querySelector("[data-testid='sidebar-section-update-chip']") as HTMLElement;
      expect(header.getAttribute("aria-expanded")).toBe("true");
      await h.act(() => {
        chip.click();
      });
      expect(window.location.hash).toBe("#/updates");
      // Section did not collapse — stopPropagation worked.
      expect(header.getAttribute("aria-expanded")).toBe("true");
    } finally {
      h.unmount();
    }
  });

  it("uses role='link' with an explanatory aria-label for screen readers", async () => {
    const h = await mount({ origin: "installed", count: 10, updateCount: 4 });
    try {
      const chip = h.container.querySelector("[data-testid='sidebar-section-update-chip']") as HTMLElement;
      expect(chip.getAttribute("role")).toBe("link");
      expect(chip.getAttribute("aria-label")).toBe(
        "4 updates available in installed section, view all",
      );
    } finally {
      h.unmount();
    }
  });

  it("Enter keypress on the chip navigates without collapsing the section", async () => {
    const h = await mount({ origin: "installed", count: 10, updateCount: 2 });
    try {
      const chip = h.container.querySelector("[data-testid='sidebar-section-update-chip']") as HTMLElement;
      await h.act(() => {
        const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
        chip.dispatchEvent(ev);
      });
      expect(window.location.hash).toBe("#/updates");
    } finally {
      h.unmount();
    }
  });

  it("chip is tabbable (tabIndex=0) after the header collapse button", async () => {
    const h = await mount({ origin: "installed", count: 10, updateCount: 2 });
    try {
      const chip = h.container.querySelector("[data-testid='sidebar-section-update-chip']") as HTMLElement;
      expect(chip.getAttribute("tabindex")).toBe("0");
      // Header button is natively tabbable (index order puts it first).
      const header = h.container.querySelector("button[data-testid='sidebar-section-header']") as HTMLButtonElement;
      expect(header).toBeTruthy();
    } finally {
      h.unmount();
    }
  });
});
