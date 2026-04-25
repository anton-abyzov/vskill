// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub StudioContext so UpdateAction doesn't need the provider tree.
const refreshUpdatesSpy = vi.fn(() => Promise.resolve());
const dismissPushUpdateSpy = vi.fn();
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    refreshUpdates: refreshUpdatesSpy,
    dismissPushUpdate: dismissPushUpdateSpy,
  }),
}));

// Shared mock EventSource — tests grab it off the spy and drive events manually.
interface FakeES extends EventSource {
  listeners: Record<string, (ev: MessageEvent) => void>;
  emit: (ev: string, data?: unknown) => void;
  closed: boolean;
}
let lastES: FakeES | null = null;
function makeFakeES(): FakeES {
  const listeners: Record<string, (ev: MessageEvent) => void> = {};
  const fake = {
    listeners,
    closed: false,
    addEventListener(type: string, cb: unknown) {
      listeners[type] = cb as (ev: MessageEvent) => void;
    },
    close() { (this as FakeES).closed = true; },
    emit(ev: string, data?: unknown) {
      const cb = listeners[ev];
      if (cb) cb({ data: data != null ? JSON.stringify(data) : "" } as MessageEvent);
    },
  } as unknown as FakeES;
  return fake;
}

// Re-export api from actual module but stub the two helpers we use.
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      startSkillUpdate: vi.fn(() => {
        lastES = makeFakeES();
        return lastES as unknown as EventSource;
      }),
      getVersionDiff: vi.fn(() => Promise.resolve({
        from: "1.0.0",
        to: "1.4.0",
        diffSummary: "mock",
        contentDiff: "--- mock\n+++ mock\n",
      })),
    },
  };
});

// Stub ChangelogViewer so we don't exercise its parseUnifiedDiff pipeline.
vi.mock("../ChangelogViewer", () => ({
  ChangelogViewer: (props: { fromLabel: string; toLabel: string }) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "changelog-viewer-stub" },
      `diff ${props.fromLabel} → ${props.toLabel}`,
    );
  },
}));

async function mountAction(skill: Partial<import("../../types").SkillInfo>) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider } = await import("../ToastProvider");
  const { UpdateAction } = await import("../UpdateAction");

  const merged: import("../../types").SkillInfo = {
    plugin: "plugin-a",
    skill: "skill-x",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    ...skill,
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(UpdateAction, { skill: merged })),
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

async function flushMicrotasks() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("UpdateAction (0683 T-009)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    refreshUpdatesSpy.mockClear();
    dismissPushUpdateSpy.mockClear();
    lastES = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders 'Update to X.Y.Z' when skill is outdated with a latest version", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.textContent).toBe("Update to 1.4.0");
    } finally {
      h.unmount();
    }
  });

  it("renders 'Update' (no version suffix) when latestVersion is null", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: undefined });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      expect(btn.textContent).toBe("Update");
    } finally {
      h.unmount();
    }
  });

  it("renders nothing when the skill has no outstanding update", async () => {
    const h = await mountAction({ updateAvailable: false });
    try {
      expect(h.container.querySelector("[data-testid='update-action']")).toBeFalsy();
    } finally {
      h.unmount();
    }
  });

  it("clicking the button flips to 'Updating…', then on 'done' fires refreshUpdates + success toast", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      expect(btn.textContent).toBe("Updating…");
      expect(btn.disabled).toBe(true);
      // Emit progress then done.
      await h.act(async () => {
        lastES!.emit("progress", { status: "downloading" });
        await flushMicrotasks();
      });
      const status = h.container.querySelector("[data-testid='update-action-progress']");
      expect(status?.textContent).toBe("downloading");
      await h.act(async () => {
        lastES!.emit("done");
        await flushMicrotasks();
      });
      expect(lastES!.closed).toBe(true);
      expect(refreshUpdatesSpy).toHaveBeenCalledTimes(1);
      // Success toast exists with the expected copy (period, not exclamation).
      const toasts = document.querySelectorAll("[data-testid='toast-item']");
      const texts = Array.from(toasts).map((t) => t.textContent).join(" | ");
      expect(texts).toContain("Updated skill-x.");
    } finally {
      h.unmount();
    }
  });

  it("0708 T-039: on 'done' also dismisses the push-store entry for this skill", async () => {
    const h = await mountAction({
      plugin: "anthropic-skills",
      skill: "pdf",
      updateAvailable: true,
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
    });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      await h.act(async () => {
        lastES!.emit("done");
        await flushMicrotasks();
      });
      expect(dismissPushUpdateSpy).toHaveBeenCalledTimes(1);
      expect(dismissPushUpdateSpy).toHaveBeenCalledWith("anthropic-skills/pdf");
    } finally {
      h.unmount();
    }
  });

  it("error event rolls back to idle and surfaces the error message in a toast", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      await h.act(async () => {
        lastES!.emit("error", { error: "disk full" });
        await flushMicrotasks();
      });
      // Button returns to idle state.
      expect(btn.textContent).toBe("Update to 1.4.0");
      expect(btn.disabled).toBe(false);
      const toasts = document.querySelectorAll("[data-testid='toast-item']");
      const texts = Array.from(toasts).map((t) => t.textContent).join(" | ");
      expect(texts).toContain("Couldn't update skill-x — disk full");
    } finally {
      h.unmount();
    }
  });

  it("SSE timeout closes the stream after SSE_TIMEOUT_MS and rolls back", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const btn = h.container.querySelector("[data-testid='update-action-button']") as HTMLButtonElement;
      await h.act(async () => { btn.click(); await flushMicrotasks(); });
      expect(lastES!.closed).toBe(false);
      await h.act(async () => {
        vi.advanceTimersByTime(60_001);
        await flushMicrotasks();
      });
      expect(lastES!.closed).toBe(true);
      // Wait for rollback + toast flush — useOptimisticAction has its own
      // outer timeout (61s) that also triggers the failure path.
      await h.act(async () => {
        vi.advanceTimersByTime(2_000);
        await flushMicrotasks();
      });
      expect(btn.textContent).toBe("Update to 1.4.0");
      expect(btn.disabled).toBe(false);
    } finally {
      h.unmount();
    }
  });

  it("toggling 'Preview changelog' loads and renders the ChangelogViewer", async () => {
    const h = await mountAction({ updateAvailable: true, currentVersion: "1.0.0", latestVersion: "1.4.0" });
    try {
      const toggle = h.container.querySelector("[data-testid='update-action-toggle-changelog']") as HTMLButtonElement;
      expect(h.container.querySelector("[data-testid='changelog-viewer-stub']")).toBeFalsy();
      await h.act(async () => {
        toggle.click();
        await flushMicrotasks();
      });
      // The fetch resolves in a microtask; let it land.
      await h.act(async () => { await flushMicrotasks(); });
      expect(h.container.querySelector("[data-testid='changelog-viewer-stub']")).toBeTruthy();
    } finally {
      h.unmount();
    }
  });
});
