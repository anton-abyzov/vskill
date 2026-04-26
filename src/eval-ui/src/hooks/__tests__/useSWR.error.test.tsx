// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0766 F-001/F-003: useSWR must capture fetch errors in state and stop
// reporting `loading: true` forever. Pre-fix, `loading` was hardcoded to
// `loading || (enabled && !entry)` which is permanently true when the
// fetcher rejected (no cache entry was set, no error state existed). And
// the rejection handler did `throw err`, producing an unhandled-promise
// rejection.
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ReactLib = typeof import("react");
type Root = ReturnType<typeof import("react-dom/client")["createRoot"]>;

interface Harness {
  container: HTMLElement;
  root: Root;
  act: (fn: () => void | Promise<void>) => Promise<void> | void;
  unmount: () => void;
}

async function mount(): Promise<Harness> {
  const React: ReactLib = await import("react");
  void React;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    act: (fn) => act(fn as never) as never,
    unmount: () => {
      try {
        root.unmount();
      } catch {}
      container.remove();
    },
  };
}

interface ProbeProps {
  swrKey: string;
  fetcher: () => Promise<unknown>;
  reportRef: { current: { data: unknown; loading: boolean; error: Error | undefined; revalidate: () => void } | null };
}

async function makeProbe(props: ProbeProps): Promise<{ React: ReactLib; element: unknown }> {
  const React: ReactLib = await import("react");
  const { useSWR } = await import("../useSWR");

  function Probe(p: ProbeProps): null {
    const result = useSWR(p.swrKey, p.fetcher);
    p.reportRef.current = {
      data: result.data,
      loading: result.loading,
      error: result.error,
      revalidate: result.revalidate,
    };
    return null;
  }
  return { React, element: React.createElement(Probe, props) };
}

let unhandled: PromiseRejectionEvent[] = [];
function captureUnhandled(): () => PromiseRejectionEvent[] {
  unhandled = [];
  const handler = (e: PromiseRejectionEvent) => {
    unhandled.push(e);
    e.preventDefault();
  };
  window.addEventListener("unhandledrejection", handler);
  return () => {
    window.removeEventListener("unhandledrejection", handler);
    return unhandled.slice();
  };
}

describe("0766 useSWR — error state + no infinite loading", () => {
  let harness: Harness;
  let stopCapture: () => PromiseRejectionEvent[];
  let uniqKeyCounter = 0;

  beforeEach(async () => {
    // Each test gets a unique key so the module-level cache from prior tests
    // doesn't bleed in.
    uniqKeyCounter++;
    harness = await mount();
    stopCapture = captureUnhandled();
  });

  afterEach(() => {
    stopCapture();
    harness.unmount();
    vi.restoreAllMocks();
  });

  function freshKey(label: string): string {
    return `t-${label}-${Date.now()}-${uniqKeyCounter}`;
  }

  it("AC-US1-01: rejected fetcher → loading false, error carries the rejection", async () => {
    const reportRef = { current: null as { data: unknown; loading: boolean; error: Error | undefined; revalidate: () => void } | null };
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));
    const { element } = await makeProbe({ swrKey: freshKey("reject"), fetcher, reportRef });

    await harness.act(async () => {
      harness.root.render(element as Parameters<Root["render"]>[0]);
    });

    // Let the rejected promise microtask settle.
    await harness.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reportRef.current).not.toBeNull();
    expect(reportRef.current!.loading).toBe(false);
    expect(reportRef.current!.error).toBeInstanceOf(Error);
    expect(reportRef.current!.error?.message).toBe("boom");
    expect(reportRef.current!.data).toBeUndefined();
    expect(fetcher).toHaveBeenCalled();
  });

  it("AC-US1-02: rejected fetcher does NOT produce an unhandled promise rejection", async () => {
    const reportRef = { current: null as { data: unknown; loading: boolean; error: Error | undefined; revalidate: () => void } | null };
    const fetcher = vi.fn().mockRejectedValue(new Error("network down"));
    const { element } = await makeProbe({ swrKey: freshKey("nounhandled"), fetcher, reportRef });

    await harness.act(async () => {
      harness.root.render(element as Parameters<Root["render"]>[0]);
    });
    await harness.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Wait one more tick to be sure the global handler would have fired.
    await new Promise((r) => setTimeout(r, 5));

    expect(unhandled.length).toBe(0);
  });

  it("AC-US1-03: revalidate() after error clears error and lets next fetch succeed", async () => {
    const reportRef = { current: null as { data: unknown; loading: boolean; error: Error | undefined; revalidate: () => void } | null };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce({ ok: true, n: 42 });
    const { element } = await makeProbe({ swrKey: freshKey("revalidate"), fetcher, reportRef });

    await harness.act(async () => {
      harness.root.render(element as Parameters<Root["render"]>[0]);
    });
    await harness.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reportRef.current!.error?.message).toBe("first failed");
    expect(reportRef.current!.loading).toBe(false);

    // Trigger a revalidate — should clear the error and re-fetch successfully.
    await harness.act(async () => {
      reportRef.current!.revalidate();
    });
    await harness.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reportRef.current!.error).toBeUndefined();
    expect(reportRef.current!.data).toEqual({ ok: true, n: 42 });
    expect(reportRef.current!.loading).toBe(false);
  });

  it("happy path: successful fetcher → data populated, loading false, error undefined", async () => {
    const reportRef = { current: null as { data: unknown; loading: boolean; error: Error | undefined; revalidate: () => void } | null };
    const fetcher = vi.fn().mockResolvedValue([{ version: "1.0.3" }]);
    const { element } = await makeProbe({ swrKey: freshKey("happy"), fetcher, reportRef });

    await harness.act(async () => {
      harness.root.render(element as Parameters<Root["render"]>[0]);
    });
    await harness.act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(reportRef.current!.data).toEqual([{ version: "1.0.3" }]);
    expect(reportRef.current!.loading).toBe(false);
    expect(reportRef.current!.error).toBeUndefined();
  });
});
