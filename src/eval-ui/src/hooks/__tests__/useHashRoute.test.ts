// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0740 T-001 (TDD RED) — hash-route hook contract
// ---------------------------------------------------------------------------
// The studio uses ad-hoc hash-based routing (no react-router). 0703 added
// `useIsCreateRoute()` for `#/create`. 0740 adds `useIsUpdatesRoute()` for
// `#/updates`. These tests lock down the contract so the next dev doesn't
// reintroduce the regression where `#/updates` had no handler and the
// "View Updates" button silently dropped users on an empty page.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mountHook<T>(useHook: () => T) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const ref: { current: T | null } = { current: null };
  function Probe() {
    ref.current = useHook();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Probe));
  });
  return {
    get(): T { return ref.current!; },
    async act(fn: () => void | Promise<void>) {
      await act(async () => { await fn(); });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

describe("0740 useHashRoute — pure predicates", () => {
  it("isUpdatesHash matches '#/updates' exactly", async () => {
    const { isUpdatesHash } = await import("../useHashRoute");
    expect(isUpdatesHash("#/updates")).toBe(true);
  });
  it("isUpdatesHash matches '#/updates/foo' (startsWith semantics)", async () => {
    const { isUpdatesHash } = await import("../useHashRoute");
    expect(isUpdatesHash("#/updates/anything")).toBe(true);
  });
  it("isUpdatesHash rejects '#/create'", async () => {
    const { isUpdatesHash } = await import("../useHashRoute");
    expect(isUpdatesHash("#/create")).toBe(false);
  });
  it("isUpdatesHash rejects empty hash", async () => {
    const { isUpdatesHash } = await import("../useHashRoute");
    expect(isUpdatesHash("")).toBe(false);
  });
  it("isUpdatesHash rejects unrelated hashes", async () => {
    const { isUpdatesHash } = await import("../useHashRoute");
    expect(isUpdatesHash("#/skills/foo")).toBe(false);
  });
  it("isCreateHash matches '#/create' (regression: existing behavior)", async () => {
    const { isCreateHash } = await import("../useHashRoute");
    expect(isCreateHash("#/create")).toBe(true);
    expect(isCreateHash("#/updates")).toBe(false);
  });
});

describe("0740 useHashRoute — reactive hooks", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("useIsUpdatesRoute is true when initial hash is '#/updates'", async () => {
    window.location.hash = "#/updates";
    const { useIsUpdatesRoute } = await import("../useHashRoute");
    const h = await mountHook(() => useIsUpdatesRoute());
    expect(h.get()).toBe(true);
    await h.unmount();
  });

  it("useIsUpdatesRoute is false when initial hash is empty", async () => {
    const { useIsUpdatesRoute } = await import("../useHashRoute");
    const h = await mountHook(() => useIsUpdatesRoute());
    expect(h.get()).toBe(false);
    await h.unmount();
  });

  it("useIsUpdatesRoute flips to true on hashchange to '#/updates'", async () => {
    const { useIsUpdatesRoute } = await import("../useHashRoute");
    const h = await mountHook(() => useIsUpdatesRoute());
    expect(h.get()).toBe(false);
    await h.act(() => {
      window.location.hash = "#/updates";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(h.get()).toBe(true);
    await h.unmount();
  });

  it("useIsUpdatesRoute flips back to false when hash clears", async () => {
    window.location.hash = "#/updates";
    const { useIsUpdatesRoute } = await import("../useHashRoute");
    const h = await mountHook(() => useIsUpdatesRoute());
    expect(h.get()).toBe(true);
    await h.act(() => {
      window.location.hash = "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(h.get()).toBe(false);
    await h.unmount();
  });

  it("useIsCreateRoute remains true for '#/create' (regression)", async () => {
    window.location.hash = "#/create";
    const { useIsCreateRoute } = await import("../useHashRoute");
    const h = await mountHook(() => useIsCreateRoute());
    expect(h.get()).toBe(true);
    await h.unmount();
  });

  it("useIsUpdatesRoute and useIsCreateRoute are mutually exclusive", async () => {
    window.location.hash = "#/updates";
    const { useIsUpdatesRoute, useIsCreateRoute } = await import("../useHashRoute");
    const a = await mountHook(() => useIsUpdatesRoute());
    const b = await mountHook(() => useIsCreateRoute());
    expect(a.get()).toBe(true);
    expect(b.get()).toBe(false);
    await a.unmount();
    await b.unmount();
  });
});
