// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(props: { open: boolean; onClose: () => void }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ShortcutModal } = await import("../ShortcutModal");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(React.createElement(ShortcutModal, props));
  });

  return {
    container,
    rerender(next: typeof props) {
      act(() => root.render(React.createElement(ShortcutModal, next)));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("ShortcutModal (T-040)", () => {
  it("renders nothing when open=false", async () => {
    const h = await mount({ open: false, onClose: vi.fn() });
    expect(h.container.querySelector("[data-testid='shortcut-modal']")).toBeNull();
    h.unmount();
  });

  it("renders a dialog with aria-modal and aria-labelledby when open", async () => {
    const h = await mount({ open: true, onClose: vi.fn() });
    const dialog = h.container.querySelector("[role='dialog']")!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("shortcut-modal-title");
    expect(h.container.querySelector("#shortcut-modal-title")?.textContent).toBe(
      "Keyboard shortcuts",
    );
    h.unmount();
  });

  it("lists Navigation / Actions / Theme groups", async () => {
    const h = await mount({ open: true, onClose: vi.fn() });
    const headings = Array.from(h.container.querySelectorAll("section h3")).map(
      (n) => n.textContent?.toLowerCase() ?? "",
    );
    expect(headings).toContain("navigation");
    expect(headings).toContain("actions");
    expect(headings).toContain("theme");
    h.unmount();
  });

  it("Escape closes the modal", async () => {
    const onClose = vi.fn();
    const h = await mount({ open: true, onClose });
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    window.dispatchEvent(e);
    expect(onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("close button has aria-label='Close' and invokes onClose", async () => {
    const onClose = vi.fn();
    const h = await mount({ open: true, onClose });
    const closeBtn = h.container.querySelector("button[aria-label='Close']") as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    closeBtn.click();
    expect(onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("click on backdrop closes, but click inside dialog does not", async () => {
    const onClose = vi.fn();
    const h = await mount({ open: true, onClose });
    const overlay = h.container.querySelector("[data-testid='shortcut-modal']") as HTMLElement;
    const dialog = h.container.querySelector("[role='dialog']") as HTMLElement;

    // Dispatch a click whose target IS the overlay (backdrop click).
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockReset();
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
    h.unmount();
  });

  it("focuses the close button on open", async () => {
    const h = await mount({ open: true, onClose: vi.fn() });
    const closeBtn = h.container.querySelector("button[aria-label='Close']");
    expect(document.activeElement).toBe(closeBtn);
    h.unmount();
  });

  it("restores focus to the trigger element on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const h = await mount({ open: true, onClose });
    // Trigger was the active element right before mount.
    h.rerender({ open: false, onClose });
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
    h.unmount();
  });
});
