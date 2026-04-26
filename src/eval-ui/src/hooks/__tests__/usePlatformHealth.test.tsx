// @vitest-environment jsdom
// 0778 US-001 — usePlatformHealth wraps useSWR with 60s TTL.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Handle {
  data: { degraded: boolean; reason: string | null; statsAgeMs: number; oldestActiveAgeMs: number } | undefined;
  loading: boolean;
}

async function renderHook(): Promise<{
  getHandle: () => Handle;
  rerender: () => void;
}> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { usePlatformHealth } = await import("../usePlatformHealth");

  const ref: { current: Handle | null } = { current: null };
  const Harness: React.FC = () => {
    const r = usePlatformHealth();
    ref.current = r;
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    getHandle: () => ref.current!,
    rerender: () => act(() => { root.render(React.createElement(Harness)); }),
  };
}

describe("usePlatformHealth (0778 US-001)", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    // Clear shared SWR cache between tests so the second test isn't served
    // the first test's cached response.
    const { mutate } = await import("../useSWR");
    mutate("platform-health");
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/platform/health")) {
        return new Response(
          JSON.stringify({
            degraded: true,
            reason: "heartbeat stale 2h",
            statsAgeMs: 7_300_000,
            oldestActiveAgeMs: 100,
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the platform health JSON from /api/platform/health", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    expect(h.data?.degraded).toBe(true);
    expect(h.data?.reason).toBe("heartbeat stale 2h");
    expect(h.data?.statsAgeMs).toBe(7_300_000);
  });

  it("on non-2xx response returns the safe fallback shape", async () => {
    globalThis.fetch = vi.fn(async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const { getHandle } = await renderHook();
    const h = getHandle();
    expect(h.data?.degraded).toBe(false);
    expect(h.data?.reason).toBe("platform-unreachable");
  });
});
