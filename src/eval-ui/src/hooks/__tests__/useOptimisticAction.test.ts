// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookReturn = import("../useOptimisticAction").OptimisticActionHandle<unknown[]>;

async function mountHook<T>(config: T) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ToastProvider } = await import("../../components/ToastProvider");
  const { useOptimisticAction } = await import("../useOptimisticAction");

  const apiRef: { current: HookReturn | null } = { current: null };

  function Probe({ cfg }: { cfg: T }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiRef.current = useOptimisticAction(cfg as any);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ToastProvider, null, React.createElement(Probe, { cfg: config })),
    );
  });

  return {
    container,
    api(): HookReturn {
      return apiRef.current!;
    },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useOptimisticAction (T-053)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies optimistically and stays silent on success", async () => {
    const snapshot = vi.fn(() => ({ state: "prev" }));
    const apply = vi.fn();
    const commit = vi.fn(() => Promise.resolve());
    const rollback = vi.fn();

    const h = await mountHook({ snapshot, apply, commit, rollback });
    try {
      const pending = h.api().run("arg");
      expect(apply).toHaveBeenCalledWith("arg");
      expect(snapshot).toHaveBeenCalledTimes(1);
      await h.act(async () => {
        await pending;
      });
      expect(commit).toHaveBeenCalledWith("arg");
      expect(rollback).not.toHaveBeenCalled();
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("rolls back + shows error toast with Retry on failure", async () => {
    const snapshot = vi.fn(() => ({ state: "prev" }));
    const apply = vi.fn();
    const rollback = vi.fn();
    const commit = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"));

    const h = await mountHook({
      snapshot,
      apply,
      commit,
      rollback,
      failureMessage: "Couldn't update skill.",
    });
    try {
      await h.act(async () => {
        await h.api().run();
      });

      expect(rollback).toHaveBeenCalledWith({ state: "prev" });
      const items = h.container.querySelectorAll("[data-testid='toast-item']");
      expect(items.length).toBe(1);
      expect(items[0].textContent).toContain("Couldn't update skill.");
      const retry = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Retry",
      );
      expect(retry).toBeTruthy();
    } finally {
      h.unmount();
    }
  });

  it("clicking Retry re-invokes the commit with the same args", async () => {
    const snapshot = vi.fn(() => ({ state: "prev" }));
    const apply = vi.fn();
    const rollback = vi.fn();
    let callCount = 0;
    const commit = vi.fn(() => {
      callCount++;
      return callCount === 1
        ? Promise.reject(new Error("first fail"))
        : Promise.resolve();
    });

    const h = await mountHook({ snapshot, apply, commit, rollback });
    try {
      await h.act(async () => {
        await h.api().run("path-a");
      });

      const retry = Array.from(h.container.querySelectorAll("button")).find(
        (b) => b.textContent === "Retry",
      )!;
      await h.act(async () => {
        retry.click();
      });

      // Allow microtasks for the retried commit promise.
      await h.act(async () => {
        await Promise.resolve();
      });

      expect(commit).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((commit.mock.calls[1] as any[])[0]).toBe("path-a");
    } finally {
      h.unmount();
    }
  });

  it("timeout after timeoutMs triggers rollback + toast", async () => {
    const snapshot = vi.fn(() => ({ state: "prev" }));
    const apply = vi.fn();
    const rollback = vi.fn();
    // Commit never resolves.
    const commit = vi.fn(() => new Promise<void>(() => {}));

    const h = await mountHook({
      snapshot,
      apply,
      commit,
      rollback,
      timeoutMs: 1000,
    });
    try {
      let runP: Promise<void> | undefined;
      await h.act(async () => {
        runP = h.api().run();
      });
      await h.act(async () => {
        vi.advanceTimersByTime(1000);
        await Promise.resolve();
      });
      await h.act(async () => {
        await runP!;
      });
      expect(rollback).toHaveBeenCalled();
      expect(h.container.querySelectorAll("[data-testid='toast-item']").length).toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("failureMessage as a function receives the error", async () => {
    const snapshot = vi.fn(() => 0);
    const apply = vi.fn();
    const rollback = vi.fn();
    const commit = vi.fn(() => Promise.reject(new Error("disk full")));
    const failureMessage = vi.fn(() => "Disk is full.");

    const h = await mountHook({ snapshot, apply, commit, rollback, failureMessage });
    try {
      await h.act(async () => {
        await h.api().run();
      });
      expect(failureMessage).toHaveBeenCalled();
      const item = h.container.querySelector("[data-testid='toast-item']")!;
      expect(item.textContent).toContain("Disk is full.");
    } finally {
      h.unmount();
    }
  });
});
