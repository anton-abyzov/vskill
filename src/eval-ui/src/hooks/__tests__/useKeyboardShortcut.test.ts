// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  parseShortcut,
  matchesShortcut,
  isTypingContext,
} from "../useKeyboardShortcut";

describe("useKeyboardShortcut: pure helpers", () => {
  describe("parseShortcut", () => {
    it("parses a single-character shortcut", () => {
      const p = parseShortcut({ key: "/", handler: () => {} });
      expect(p.key).toBe("/");
      expect(p.meta).toBe(false);
      expect(p.ctrl).toBe(false);
    });

    it("parses chord shorthand like cmd+k", () => {
      const p = parseShortcut({ key: "cmd+k", handler: () => {} });
      expect(p.meta).toBe(true);
      expect(p.key).toBe("k");
    });

    it("parses cmd+shift+d", () => {
      const p = parseShortcut({ key: "cmd+shift+d", handler: () => {} });
      expect(p.meta).toBe(true);
      expect(p.shift).toBe(true);
      expect(p.key).toBe("d");
    });

    it("parses ctrl+b", () => {
      const p = parseShortcut({ key: "ctrl+b", handler: () => {} });
      expect(p.ctrl).toBe(true);
      expect(p.key).toBe("b");
    });

    it("keeps named keys untouched (Escape, Enter)", () => {
      const p = parseShortcut({ key: "Escape", handler: () => {} });
      expect(p.key).toBe("Escape");
    });
  });

  describe("matchesShortcut", () => {
    const mk = (key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent => {
      return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...opts } as KeyboardEvent;
    };

    it("matches a single-char shortcut", () => {
      const s = parseShortcut({ key: "/", handler: () => {} });
      expect(matchesShortcut(mk("/"), s)).toBe(true);
    });

    it("is case-insensitive for single chars", () => {
      const s = parseShortcut({ key: "j", handler: () => {} });
      expect(matchesShortcut(mk("J"), s)).toBe(true);
    });

    it("matches cmd+k only when metaKey is down", () => {
      const s = parseShortcut({ key: "cmd+k", handler: () => {} });
      expect(matchesShortcut(mk("k", { metaKey: true }), s)).toBe(true);
      expect(matchesShortcut(mk("k"), s)).toBe(false);
    });

    it("does not fire cmd+k when ctrl is down instead", () => {
      const s = parseShortcut({ key: "cmd+k", handler: () => {} });
      expect(matchesShortcut(mk("k", { ctrlKey: true }), s)).toBe(false);
    });

    it("requires shift to match cmd+shift+d", () => {
      const s = parseShortcut({ key: "cmd+shift+d", handler: () => {} });
      expect(matchesShortcut(mk("D", { metaKey: true, shiftKey: true }), s)).toBe(true);
      expect(matchesShortcut(mk("d", { metaKey: true }), s)).toBe(false);
    });
  });

  describe("isTypingContext", () => {
    it("returns true for <input>", () => {
      const el = document.createElement("input");
      expect(isTypingContext(el)).toBe(true);
    });
    it("returns true for <textarea>", () => {
      const el = document.createElement("textarea");
      expect(isTypingContext(el)).toBe(true);
    });
    it("returns true for contenteditable", () => {
      const el = document.createElement("div");
      el.setAttribute("contenteditable", "true");
      expect(isTypingContext(el)).toBe(true);
    });
    it("returns false for a plain <button>", () => {
      const el = document.createElement("button");
      expect(isTypingContext(el)).toBe(false);
    });
    it("returns false for null target", () => {
      expect(isTypingContext(null)).toBe(false);
    });
  });
});

describe("useKeyboardShortcut: hook", () => {
  async function renderHook(args: unknown) {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { useKeyboardShortcut } = await import("../useKeyboardShortcut");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    function Probe({ args }: { args: unknown }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useKeyboardShortcut(args as any);
      return null;
    }

    act(() => {
      root.render(React.createElement(Probe, { args }));
    });

    return {
      update(next: unknown) {
        act(() => root.render(React.createElement(Probe, { args: next })));
      },
      unmount() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  function press(target: EventTarget, key: string, opts: Partial<KeyboardEventInit> = {}) {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
    if (target instanceof HTMLElement) target.dispatchEvent(e);
    else target.dispatchEvent(e);
    return e;
  }

  beforeEach(() => {
    // Start each test with an empty body focus.
    document.body.focus();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires the handler when the key is pressed on window", async () => {
    const h = vi.fn();
    const hook = await renderHook({ key: "/", handler: h });
    try {
      press(window, "/");
      expect(h).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
    }
  });

  it("does NOT fire when the active element is an <input>", async () => {
    const h = vi.fn();
    const hook = await renderHook({ key: "/", handler: h });
    try {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      press(input, "/");
      expect(h).toHaveBeenCalledTimes(0);
      input.remove();
    } finally {
      hook.unmount();
    }
  });

  it("still fires a chord shortcut (cmd+k) even inside an input", async () => {
    const h = vi.fn();
    const hook = await renderHook({ key: "cmd+k", handler: h });
    try {
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();
      press(input, "k", { metaKey: true });
      expect(h).toHaveBeenCalledTimes(1);
      input.remove();
    } finally {
      hook.unmount();
    }
  });

  it("unregisters on unmount", async () => {
    const h = vi.fn();
    const hook = await renderHook({ key: "/", handler: h });
    hook.unmount();
    press(window, "/");
    expect(h).toHaveBeenCalledTimes(0);
  });

  it("accepts an array of shortcuts", async () => {
    const hJ = vi.fn();
    const hK = vi.fn();
    const hook = await renderHook([
      { key: "j", handler: hJ },
      { key: "k", handler: hK },
    ]);
    try {
      press(window, "j");
      press(window, "k");
      expect(hJ).toHaveBeenCalledTimes(1);
      expect(hK).toHaveBeenCalledTimes(1);
    } finally {
      hook.unmount();
    }
  });
});
