// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { scoreCommand } from "../CommandPalette";
import type { Command } from "../CommandPalette";

function cmd(label: string, id = label, description?: string, keywords: string[] = []): Command {
  return { id, label, description, keywords, onInvoke: () => {} };
}

describe("CommandPalette: scoreCommand", () => {
  it("returns 0 for non-matching query", () => {
    expect(scoreCommand(cmd("Run benchmark"), "xyzzy")).toBe(0);
  });
  it("scores a prefix match higher than substring", () => {
    const s1 = scoreCommand(cmd("Run benchmark"), "run");
    const s2 = scoreCommand(cmd("Run benchmark"), "bench");
    expect(s1).toBeGreaterThan(s2);
  });
  it("returns non-zero for fuzzy char-in-order match", () => {
    expect(scoreCommand(cmd("Switch theme"), "stm")).toBeGreaterThan(0);
  });
  it("returns a base positive score for empty query", () => {
    expect(scoreCommand(cmd("Anything"), "")).toBe(1);
  });
});

async function mount(open: boolean, commands: Command[], onClose = vi.fn()) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { CommandPalette } = await import("../CommandPalette");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(CommandPalette, { open, commands, onClose }));
  });
  return {
    container,
    onClose,
    rerender(next: { open: boolean; commands: Command[]; onClose?: () => void }) {
      act(() =>
        root.render(
          React.createElement(CommandPalette, {
            open: next.open,
            commands: next.commands,
            onClose: next.onClose ?? onClose,
          }),
        ),
      );
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flushRAF() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** React's controlled input requires the native value setter to trigger onChange. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CommandPalette (T-039)", () => {
  it("renders nothing when open=false", async () => {
    const h = await mount(false, []);
    expect(h.container.querySelector("[data-testid='command-palette']")).toBeNull();
    h.unmount();
  });

  it("renders dialog with combobox + listbox when open", async () => {
    const commands = [cmd("Run benchmark"), cmd("Switch theme")];
    const h = await mount(true, commands);
    expect(h.container.querySelector("[role='dialog']")).toBeTruthy();
    expect(h.container.querySelector("[role='combobox']")).toBeTruthy();
    expect(h.container.querySelector("[role='listbox']")).toBeTruthy();
    const options = h.container.querySelectorAll("[role='option']");
    expect(options.length).toBe(2);
    h.unmount();
  });

  it("filters the listbox as the user types", async () => {
    const { act } = await import("react");
    const commands = [cmd("Run benchmark"), cmd("Switch theme"), cmd("New skill")];
    const h = await mount(true, commands);
    const input = h.container.querySelector("input") as HTMLInputElement;
    act(() => {
      setInputValue(input, "bench");
    });
    const options = h.container.querySelectorAll("[role='option']");
    expect(options.length).toBe(1);
    expect(options[0].textContent).toContain("Run benchmark");
    h.unmount();
  });

  it("Escape closes the palette", async () => {
    const onClose = vi.fn();
    const h = await mount(true, [cmd("x")], onClose);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("Enter invokes the highlighted command and closes", async () => {
    const invoke = vi.fn();
    const onClose = vi.fn();
    const c: Command = { id: "run", label: "Run benchmark", onInvoke: invoke };
    const h = await mount(true, [c], onClose);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("ArrowDown moves the cursor", async () => {
    const { act } = await import("react");
    const commands = [cmd("a"), cmd("b"), cmd("c")];
    const h = await mount(true, commands);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const options = h.container.querySelectorAll("[role='option']");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    h.unmount();
  });

  it("input is focused after open (lazy render, uses RAF)", async () => {
    const h = await mount(true, [cmd("x")]);
    await flushRAF();
    const input = h.container.querySelector("input");
    expect(document.activeElement).toBe(input);
    h.unmount();
  });

  it("click on backdrop closes", async () => {
    const onClose = vi.fn();
    const h = await mount(true, [cmd("x")], onClose);
    const backdrop = h.container.querySelector("[data-testid='command-palette']") as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("shows 'No matches.' when query has no hits", async () => {
    const { act } = await import("react");
    const h = await mount(true, [cmd("Run benchmark")]);
    const input = h.container.querySelector("input") as HTMLInputElement;
    act(() => {
      setInputValue(input, "xzywarble");
    });
    expect(h.container.textContent).toContain("No matches.");
    h.unmount();
  });
});
