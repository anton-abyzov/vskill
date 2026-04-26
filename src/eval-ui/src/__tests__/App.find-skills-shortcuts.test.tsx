// @vitest-environment jsdom
// 0741 T-016 + T-033 regression: App-level keyboard shortcut routing.
//
// We don't mount the full <App /> here — App pulls in dozens of providers and
// network paths that would dwarf the contract under test. Instead we exercise
// the same shortcut hook stack App.tsx uses (`useKeyboardShortcut`) with the
// SAME shortcut config registered there, then assert that:
//   - `cmd+k`        → toggles the CommandPalette callback (NOT findSkills).
//   - `cmd+shift+k`  → dispatches `openFindSkills`.
//   - `ctrl+shift+k` → dispatches `openFindSkills`.
//   - `cmd+p`        → toggles the ProjectCommandPalette callback.
//   - bare `cmd+k` does NOT trigger findSkills.
//
// If App.tsx's keymap diverges from this harness (e.g. the chord key changes),
// this test must be updated in lockstep.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useKeyboardShortcut } from "../hooks/useKeyboardShortcut";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Hits {
  commandPalette: number;
  projectPalette: number;
  findSkillsEvents: number;
}

function ShortcutHarness({ hits }: { hits: Hits }) {
  const [, setCommandOpen] = useState(false);
  const [, setProjectOpen] = useState(false);

  useKeyboardShortcut(
    [
      {
        key: "p",
        meta: true,
        handler: () => {
          hits.projectPalette++;
          setProjectOpen((v) => !v);
        },
      },
    ],
    { enabled: true },
  );

  useKeyboardShortcut([
    { key: "cmd+k", handler: () => { hits.commandPalette++; setCommandOpen((p) => !p); } },
    { key: "ctrl+k", handler: () => { hits.commandPalette++; setCommandOpen((p) => !p); } },
    {
      key: "cmd+shift+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
    {
      key: "ctrl+shift+k",
      handler: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("openFindSkills"));
        }
      },
    },
  ]);

  return React.createElement("div", { "data-testid": "harness" });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let findSkillsListener: ((e: Event) => void) | null = null;
let hits: Hits;

beforeEach(() => {
  hits = { commandPalette: 0, projectPalette: 0, findSkillsEvents: 0 };
  findSkillsListener = () => { hits.findSkillsEvents++; };
  window.addEventListener("openFindSkills", findSkillsListener);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (findSkillsListener) window.removeEventListener("openFindSkills", findSkillsListener);
  findSkillsListener = null;
  if (root) act(() => root!.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

function fireKey(opts: { key: string; meta?: boolean; ctrl?: boolean; shift?: boolean }) {
  const evt = new KeyboardEvent("keydown", {
    key: opts.key,
    metaKey: !!opts.meta,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shift,
    bubbles: true,
  });
  // Ensure the event target is body so isTypingContext returns false.
  Object.defineProperty(evt, "target", { value: document.body, configurable: true });
  window.dispatchEvent(evt);
}

describe("App shortcut routing — 0741 T-016 + T-033 regression", () => {
  it("bare ⌘K opens CommandPalette and does NOT fire openFindSkills", () => {
    act(() => { root!.render(React.createElement(ShortcutHarness, { hits })); });
    act(() => { fireKey({ key: "k", meta: true }); });
    expect(hits.commandPalette).toBe(1);
    expect(hits.findSkillsEvents).toBe(0);
  });

  it("⌘⇧K dispatches openFindSkills", () => {
    act(() => { root!.render(React.createElement(ShortcutHarness, { hits })); });
    act(() => { fireKey({ key: "k", meta: true, shift: true }); });
    expect(hits.findSkillsEvents).toBe(1);
    expect(hits.commandPalette).toBe(0);
  });

  it("Ctrl+Shift+K dispatches openFindSkills", () => {
    act(() => { root!.render(React.createElement(ShortcutHarness, { hits })); });
    act(() => { fireKey({ key: "k", ctrl: true, shift: true }); });
    expect(hits.findSkillsEvents).toBe(1);
    expect(hits.commandPalette).toBe(0);
  });

  it("⌘P opens ProjectCommandPalette (no regression)", () => {
    act(() => { root!.render(React.createElement(ShortcutHarness, { hits })); });
    act(() => { fireKey({ key: "p", meta: true }); });
    expect(hits.projectPalette).toBe(1);
    expect(hits.findSkillsEvents).toBe(0);
  });

  it("⌘⇧K does NOT also trigger CommandPalette (modifier exact-match)", () => {
    act(() => { root!.render(React.createElement(ShortcutHarness, { hits })); });
    act(() => { fireKey({ key: "k", meta: true, shift: true }); });
    expect(hits.commandPalette).toBe(0);
  });
});
