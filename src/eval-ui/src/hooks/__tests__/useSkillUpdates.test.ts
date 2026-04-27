// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HookReturn = import("../useSkillUpdates").UseSkillUpdatesReturn;

// Mock the api module so we can spy on getSkillUpdates.
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkillUpdates: vi.fn(),
    },
  };
});

async function mountHook(opts?: Parameters<typeof import("../useSkillUpdates").useSkillUpdates>[0]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSkillUpdates } = await import("../useSkillUpdates");

  const apiRef: { current: HookReturn | null } = { current: null };

  function Probe() {
    apiRef.current = useSkillUpdates(opts);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  return {
    api(): HookReturn {
      return apiRef.current!;
    },
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Helper to drive the visibility flag on document.
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function flushMicrotasks() {
  // Two ticks handle the fetch → setState → commit pair.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useSkillUpdates (T-001)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setVisibility("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function withMocked(
    fixture: Array<{ name: string; installed: string; latest: string; updateAvailable: boolean }>,
    body: (spy: ReturnType<typeof vi.fn>, helpers: Awaited<ReturnType<typeof mountHook>>) => Promise<void>,
    opts?: Parameters<typeof import("../useSkillUpdates").useSkillUpdates>[0],
  ) {
    const { api } = await import("../../api");
    const spy = api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>;
    spy.mockReset();
    spy.mockResolvedValue(fixture);
    const h = await mountHook(opts);
    try {
      await body(spy, h);
    } finally {
      h.unmount();
    }
  }

  it("fires the initial fetch on mount and exposes the merged result", async () => {
    await withMocked(
      [{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }],
      async (spy, h) => {
        await h.act(async () => {
          vi.advanceTimersByTime(0);
          await flushMicrotasks();
        });
        expect(spy).toHaveBeenCalledTimes(1);
        expect(h.api().updateCount).toBe(1);
        expect(h.api().updatesMap.get("foo")?.latest).toBe("1.1.0");
      },
    );
  });

  it("polls on the configured interval when visible", async () => {
    await withMocked(
      [{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }],
      async (spy, h) => {
        await h.act(async () => { await flushMicrotasks(); });
        await h.act(async () => {
          vi.advanceTimersByTime(1000);
          await flushMicrotasks();
        });
        expect(spy).toHaveBeenCalledTimes(2);
        await h.act(async () => {
          vi.advanceTimersByTime(1000);
          await flushMicrotasks();
        });
        expect(spy).toHaveBeenCalledTimes(3);
      },
      { intervalMs: 1000, debounceMs: 100, staleAfterMs: 10 },
    );
  });

  it("pauses polling while the tab is hidden and resumes after debounce + stale check", async () => {
    await withMocked(
      [{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }],
      async (spy, h) => {
        await h.act(async () => { await flushMicrotasks(); });
        expect(spy).toHaveBeenCalledTimes(1);
        // Go hidden — no polls during hidden window.
        await h.act(async () => {
          setVisibility("hidden");
          await flushMicrotasks();
        });
        await h.act(async () => {
          vi.advanceTimersByTime(5000);
          await flushMicrotasks();
        });
        expect(spy).toHaveBeenCalledTimes(1);
        // Back to visible — after debounce, since last fetch >10ms ago, refresh fires.
        await h.act(async () => {
          setVisibility("visible");
          await flushMicrotasks();
        });
        await h.act(async () => {
          vi.advanceTimersByTime(100);
          await flushMicrotasks();
        });
        expect(spy).toHaveBeenCalledTimes(2);
      },
      { intervalMs: 100_000, debounceMs: 100, staleAfterMs: 10 },
    );
  });

  it("dedupes concurrent refresh() calls into one in-flight fetch", async () => {
    let resolveIt: ((v: any) => void) | null = null;
    const pending = new Promise((r) => (resolveIt = r));
    await withMocked(
      [{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }],
      async (spy, h) => {
        // Allow the mount-triggered initial fetch to resolve.
        await h.act(async () => { await flushMicrotasks(); });
        expect(spy).toHaveBeenCalledTimes(1);
        // Queue a never-resolving impl for the next fetch so we can probe dedup.
        spy.mockImplementationOnce(() => pending as Promise<any>);
        // Fire two concurrent refreshes — both should share the in-flight.
        let p1: Promise<void> | null = null;
        let p2: Promise<void> | null = null;
        await h.act(async () => {
          p1 = h.api().refresh();
          p2 = h.api().refresh();
        });
        // One new api call, not two.
        expect(spy).toHaveBeenCalledTimes(2);
        expect(p1).toBe(p2);
        await h.act(async () => {
          resolveIt!([{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }]);
          await p1!;
        });
      },
      { intervalMs: 100_000, debounceMs: 100 },
    );
  });

  it("preserves previous updates and sets error on timeout", async () => {
    await withMocked(
      [{ name: "p/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true }],
      async (spy, h) => {
        // Initial succeeds.
        await h.act(async () => { await flushMicrotasks(); });
        expect(h.api().updateCount).toBe(1);
        // Second call never resolves — watchdog should fire.
        spy.mockImplementationOnce(() => new Promise(() => {}));
        let p: Promise<void> | null = null;
        await h.act(async () => {
          p = h.api().refresh();
        });
        await h.act(async () => {
          vi.advanceTimersByTime(500);
          await flushMicrotasks();
          await p;
        });
        expect(h.api().error?.message).toBe("TIMEOUT");
        // Previous data retained.
        expect(h.api().updateCount).toBe(1);
      },
      { intervalMs: 100_000, debounceMs: 100, timeoutMs: 500 },
    );
  });

  it("computes updateCount by filtering on updateAvailable", async () => {
    await withMocked(
      [
        { name: "p/a", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "p/b", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
        { name: "p/c", installed: "2.0.0", latest: "3.0.0", updateAvailable: true },
      ],
      async (_spy, h) => {
        await h.act(async () => { await flushMicrotasks(); });
        expect(h.api().updateCount).toBe(2);
        expect(h.api().updates).toHaveLength(3);
      },
    );
  });

  // 1.0.0 — Map-keying regression coverage. Pre-1.0 `buildMap` keyed solely
  // by leaf, so two distinct outdated skills could silently overwrite one
  // another in `updatesMap`. The dropdown panel reads `updates[]` directly
  // and was unaffected, but downstream consumers of `updatesMap` (and
  // anything that mirrored the same leaf-only pattern) were not. The fix
  // primary-keys by full name and adds a leaf alias only when unambiguous.
  it("keeps two distinct updates addressable by full name in updatesMap", async () => {
    await withMocked(
      [
        { name: "anton/vskill/skill-builder", installed: "0.1.0", latest: "1.0.3", updateAvailable: true },
        { name: "anton/hi-anton/hi-anton", installed: "1.0.2", latest: "1.0.3", updateAvailable: true },
      ],
      async (_spy, h) => {
        await h.act(async () => { await flushMicrotasks(); });
        const m = h.api().updatesMap;
        expect(h.api().updateCount).toBe(2);
        expect(h.api().updates).toHaveLength(2);
        expect(m.get("anton/vskill/skill-builder")?.latest).toBe("1.0.3");
        expect(m.get("anton/hi-anton/hi-anton")?.latest).toBe("1.0.3");
        // Distinct leaves — leaf aliases resolve as expected.
        expect(m.get("skill-builder")?.installed).toBe("0.1.0");
        expect(m.get("hi-anton")?.installed).toBe("1.0.2");
      },
    );
  });

  it("preserves both entries on leaf collision and drops the ambiguous leaf alias", async () => {
    await withMocked(
      [
        { name: "acme/plugin-x/foo", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
        { name: "other/plugin-y/foo", installed: "2.0.0", latest: "2.1.0", updateAvailable: true },
      ],
      async (_spy, h) => {
        await h.act(async () => { await flushMicrotasks(); });
        const m = h.api().updatesMap;
        expect(h.api().updateCount).toBe(2);
        expect(h.api().updates).toHaveLength(2);
        // Both full keys remain.
        expect(m.get("acme/plugin-x/foo")?.latest).toBe("1.1.0");
        expect(m.get("other/plugin-y/foo")?.latest).toBe("2.1.0");
        // Ambiguous leaf alias is dropped — leaf-only consumers must
        // disambiguate via full key. Pre-1.0 this returned whichever entry
        // wrote last, silently hiding the other.
        expect(m.has("foo")).toBe(false);
      },
    );
  });
});
