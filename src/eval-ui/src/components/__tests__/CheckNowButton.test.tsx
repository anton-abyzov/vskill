// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { UpdateStoreEntry } from "../../types/skill-update";

interface StudioStub {
  updatesById: ReadonlyMap<string, UpdateStoreEntry>;
}

let stub: StudioStub = { updatesById: new Map() };
vi.mock("../../StudioContext", () => ({
  useStudio: () => stub,
}));

const rescanSpy = vi.fn(() => Promise.resolve({ jobId: "req-1" }));
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      rescanSkill: rescanSpy,
    },
  };
});

async function mount(props: {
  plugin: string;
  skill: string;
  trackedForUpdates?: boolean;
  discoveryBackedOff?: boolean;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { CheckNowButton } = await import("../CheckNowButton");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(CheckNowButton, props));
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

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function makeEntry(partial: Partial<UpdateStoreEntry> = {}): UpdateStoreEntry {
  return {
    skillId: partial.skillId ?? "anthropic-skills/pdf",
    version: partial.version ?? "2.0.0",
    diffSummary: partial.diffSummary,
    eventId: partial.eventId ?? "evt-1",
    publishedAt: partial.publishedAt ?? new Date().toISOString(),
    receivedAt: partial.receivedAt ?? Date.now(),
  };
}

describe("CheckNowButton (0708 T-073/T-074)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    rescanSpy.mockClear();
    stub = { updatesById: new Map() };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC-US8-03: renders 'Check now' for tracked skills", async () => {
    const h = await mount({ plugin: "anthropic-skills", skill: "pdf", trackedForUpdates: true });
    try {
      const btn = h.container.querySelector("[data-testid='check-now-button']") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Check now");
      expect(btn.disabled).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("AC-US8-04: renders nothing when trackedForUpdates === false", async () => {
    const h = await mount({ plugin: "legacy", skill: "x", trackedForUpdates: false });
    try {
      expect(h.container.querySelector("[data-testid='check-now-button']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US8-04: renders nothing when discoveryBackedOff is true", async () => {
    const h = await mount({ plugin: "anthropic-skills", skill: "pdf", trackedForUpdates: true, discoveryBackedOff: true });
    try {
      expect(h.container.querySelector("[data-testid='check-now-button']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US8-03: clicking disables the button + shows spinner; api.rescanSkill is invoked", async () => {
    const h = await mount({ plugin: "anthropic-skills", skill: "pdf", trackedForUpdates: true });
    try {
      const btn = h.container.querySelector("[data-testid='check-now-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      expect(rescanSpy).toHaveBeenCalledTimes(1);
      expect(rescanSpy).toHaveBeenCalledWith("anthropic-skills", "pdf");
      expect(btn.disabled).toBe(true);
      expect(h.container.querySelector("[data-testid='check-now-spinner']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US8-03: spinner clears when matching skill.updated push entry lands", async () => {
    const h = await mount({ plugin: "anthropic-skills", skill: "pdf", trackedForUpdates: true });
    try {
      const btn = h.container.querySelector("[data-testid='check-now-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      expect(btn.disabled).toBe(true);
      // Simulate push entry arrival for this skill.
      stub = {
        updatesById: new Map([["anthropic-skills/pdf", makeEntry()]]),
      };
      // Force a re-render.
      await h.act(async () => {
        // Re-run microtasks to give React a chance to reconcile any
        // subscription the component holds. Update tests rely on the
        // component re-reading stub via useStudio each render.
        await flushMicrotasks();
      });
      // Trigger a re-render by clicking (no-op if disabled) or remount.
      // The easiest way: advance any internal interval polling updatesById.
      await h.act(async () => { vi.advanceTimersByTime(300); await flushMicrotasks(); });
      // Re-query after idle; component should have cleared itself.
      const btn2 = h.container.querySelector("[data-testid='check-now-button']") as HTMLButtonElement;
      expect(btn2.disabled).toBe(false);
      expect(h.container.querySelector("[data-testid='check-now-spinner']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("AC-US8-03: after 30s timeout without a push event, spinner clears + shows 'No changes detected'", async () => {
    const h = await mount({ plugin: "anthropic-skills", skill: "pdf", trackedForUpdates: true });
    try {
      const btn = h.container.querySelector("[data-testid='check-now-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      expect(btn.disabled).toBe(true);
      await h.act(async () => { vi.advanceTimersByTime(30_001); await flushMicrotasks(); });
      expect(btn.disabled).toBe(false);
      expect(h.container.querySelector("[data-testid='check-now-spinner']")).toBeFalsy();
      const tip = h.container.querySelector("[data-testid='check-now-no-changes']");
      expect(tip).toBeTruthy();
      expect(tip?.textContent).toMatch(/no changes detected/i);
    } finally {
      h.unmount();
    }
  });
});
