// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// usePluginsPolling — unit tests for AC-US2-01 through AC-US2-05
// ---------------------------------------------------------------------------
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Minimal React hook harness (no @testing-library dependency)
// ---------------------------------------------------------------------------
async function mountHook() {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { usePluginsPolling } = await import("../usePluginsPolling");

  type ReturnType = import("../usePluginsPolling").UsePluginsPollingReturn;
  const ref: { current: ReturnType | null } = { current: null };

  function Probe() {
    ref.current = usePluginsPolling();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    get(): ReturnType {
      return ref.current!;
    },
    async act(fn: () => void | Promise<void>) {
      await act(async () => { await fn(); });
    },
    async unmount() {
      await act(async () => { root.unmount(); });
      container.remove();
    },
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePluginsPolling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Reset visibility to visible before each test
    setVisibility("visible");
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // Reset module so hook state is fresh between tests
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // AC-US2-01: max 5 retries with exponential backoff (1s, 2s, 4s, 8s, 16s)
  // -------------------------------------------------------------------------
  it("AC-US2-01: enters paused state after 5 consecutive failures with exponential backoff", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const harness = await mountHook();

    // Initial fetch fires immediately on mount
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 1st retry after 1s
    await harness.act(() => vi.advanceTimersByTime(1_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 2nd retry after 2s
    await harness.act(() => vi.advanceTimersByTime(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 3rd retry after 4s
    await harness.act(() => vi.advanceTimersByTime(4_000));
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 4th retry after 8s
    await harness.act(() => vi.advanceTimersByTime(8_000));
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 5th retry after 16s
    await harness.act(() => vi.advanceTimersByTime(16_000));
    expect(fetchMock).toHaveBeenCalledTimes(6);

    // Now paused — advancing time further should NOT trigger more fetches
    await harness.act(() => vi.advanceTimersByTime(60_000));
    expect(fetchMock).toHaveBeenCalledTimes(6);

    expect(harness.get().paused).toBe(true);

    await harness.unmount();
  });

  // -------------------------------------------------------------------------
  // AC-US2-02: no polling while document.visibilityState === "hidden"
  // -------------------------------------------------------------------------
  it("AC-US2-02: suspends polling when tab is hidden, resumes when visible", async () => {
    // Make fetch succeed so we see normal polling
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [] }),
    } as Response);

    const harness = await mountHook();

    // Initial fetch
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Hide tab — no more fetches should occur
    await harness.act(() => setVisibility("hidden"));
    await harness.act(() => vi.advanceTimersByTime(120_000));
    expect(fetchMock).toHaveBeenCalledTimes(1); // still just 1

    // Make tab visible again — should fetch immediately
    await harness.act(() => setVisibility("visible"));
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await harness.unmount();
  });

  // -------------------------------------------------------------------------
  // AC-US2-03: unmount aborts in-flight request via AbortController
  // -------------------------------------------------------------------------
  it("AC-US2-03: component unmount aborts the in-flight request", async () => {
    let capturedSignal: AbortSignal | undefined;

    // Fetch that captures the AbortSignal and never resolves
    fetchMock.mockImplementation((_url: string, opts: RequestInit) => {
      capturedSignal = opts?.signal as AbortSignal | undefined;
      return new Promise(() => {}); // never resolves
    });

    const harness = await mountHook();

    // Trigger the initial fetch
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Unmount — should abort the in-flight request
    await harness.unmount();

    expect(capturedSignal!.aborted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-US2-04: ≤ 1 /api/plugins request per minute in steady state
  // -------------------------------------------------------------------------
  it("AC-US2-04: steady-state polling rate is ≤ 1 request per minute", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [] }),
    } as Response);

    const harness = await mountHook();

    // Advance 60 seconds, counting requests
    await harness.act(() => vi.advanceTimersByTime(0)); // initial fetch
    await harness.act(() => vi.advanceTimersByTime(60_000));

    // Should be at most 2: initial + 1 poll (at 60s boundary)
    // The contract is ≤ 1 per minute, so ≤ 2 total over first 60s is fine
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);

    await harness.unmount();
  });

  // -------------------------------------------------------------------------
  // AC-US2-01 supplement: manual retry resets backoff and resumes polling
  // -------------------------------------------------------------------------
  it("manual retry() resets paused state and fires a new fetch", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const harness = await mountHook();

    // Drive through 5 failures to reach paused state
    await harness.act(() => vi.advanceTimersByTime(0));      // attempt 1
    await harness.act(() => vi.advanceTimersByTime(1_000));  // attempt 2
    await harness.act(() => vi.advanceTimersByTime(2_000));  // attempt 3
    await harness.act(() => vi.advanceTimersByTime(4_000));  // attempt 4
    await harness.act(() => vi.advanceTimersByTime(8_000));  // attempt 5
    await harness.act(() => vi.advanceTimersByTime(16_000)); // attempt 6 → paused

    expect(harness.get().paused).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;

    // Call manual retry
    await harness.act(() => { harness.get().retry(); });
    await harness.act(() => vi.advanceTimersByTime(0));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);

    await harness.unmount();
  });

  // -------------------------------------------------------------------------
  // F-003 (0736 closure): triggerPluginsRefresh refreshes all mounted instances
  // and is a no-op for unmounted instances.
  // -------------------------------------------------------------------------
  it("triggerPluginsRefresh fires a fresh fetch in mounted hook instances", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [] }),
    } as Response);

    const harness = await mountHook();

    // Initial fetch
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Import the trigger and call it
    const { triggerPluginsRefresh } = await import("../usePluginsPolling");
    await harness.act(() => {
      triggerPluginsRefresh();
    });
    await harness.act(() => vi.advanceTimersByTime(0));

    expect(fetchMock).toHaveBeenCalledTimes(2);

    await harness.unmount();
  });

  it("triggerPluginsRefresh is a no-op for an unmounted hook (no errors, no fetch)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [] }),
    } as Response);

    const harness = await mountHook();
    await harness.act(() => vi.advanceTimersByTime(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Unmount — the hook should remove itself from the refresh callbacks set
    await harness.unmount();

    const callsAfterUnmount = fetchMock.mock.calls.length;

    // Trigger after unmount — must not throw, must not fetch
    const { triggerPluginsRefresh } = await import("../usePluginsPolling");
    expect(() => triggerPluginsRefresh()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock.mock.calls.length).toBe(callsAfterUnmount);
  });

  // -------------------------------------------------------------------------
  // AC-US2-01 supplement: visibilityState=visible after pause resumes polling
  // -------------------------------------------------------------------------
  it("visibility becoming visible after pause resumes polling", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const harness = await mountHook();

    // Drive to paused
    await harness.act(() => vi.advanceTimersByTime(0));
    await harness.act(() => vi.advanceTimersByTime(1_000));
    await harness.act(() => vi.advanceTimersByTime(2_000));
    await harness.act(() => vi.advanceTimersByTime(4_000));
    await harness.act(() => vi.advanceTimersByTime(8_000));
    await harness.act(() => vi.advanceTimersByTime(16_000));

    expect(harness.get().paused).toBe(true);
    const callsBefore = fetchMock.mock.calls.length;

    // Simulate tab hide → show cycle
    await harness.act(() => setVisibility("hidden"));
    await harness.act(() => setVisibility("visible"));
    await harness.act(() => vi.advanceTimersByTime(0));

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);

    await harness.unmount();
  });
});
