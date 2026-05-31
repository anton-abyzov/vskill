// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0856 — SubmissionQueuePanel tests.
// ---------------------------------------------------------------------------
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  FetchEventStreamHandle,
  FetchEventStreamOptions,
} from "../../api/sse";

const mockGetMyQueue = vi.fn();
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    api: {
      getMyQueue: (...a: unknown[]) => mockGetMyQueue(...a),
    },
  };
});

import { SubmissionQueuePanel } from "../SubmissionQueuePanel";
import { resetDecisionDedupe } from "../../hooks/useSubmissionNotifications";

let container: HTMLDivElement;
let root: Root;

// Captured handler from the injected openStream so tests can push frames.
let emit: ((event: { event: string; data: string }) => void) | null = null;
let lastOptions: FetchEventStreamOptions | null = null;
let lastUrl: string | null = null;
let openCount = 0;
const closeSpy = vi.fn();

function fakeOpenStream(url: string, opts: FetchEventStreamOptions): FetchEventStreamHandle {
  lastOptions = opts;
  lastUrl = url;
  openCount += 1;
  emit = (frame) => opts.onEvent(frame);
  return { close: closeSpy };
}

const notifySpy = vi.fn(async () => true);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockGetMyQueue.mockReset();
  closeSpy.mockReset();
  notifySpy.mockClear();
  resetDecisionDedupe();
  emit = null;
  lastOptions = null;
  lastUrl = null;
  openCount = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function pushEvent(data: Record<string, unknown>) {
  emit!({ event: "state_changed", data: JSON.stringify(data) });
}

const ROW = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  skillName: "greet",
  repoUrl: "https://github.com/o/r",
  state: "RECEIVED",
  createdAt: "2026-05-30T00:00:00Z",
  updatedAt: "2026-05-30T00:00:00Z",
  ...over,
});

describe("SubmissionQueuePanel", () => {
  it("renders the user's queue rows with skill, state, and position", async () => {
    mockGetMyQueue.mockResolvedValueOnce({
      submissions: [ROW({ id: "s1", skillName: "greet" })],
      queuePositions: { s1: 4 },
    });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    expect(container.querySelector('[data-testid="queue-row-s1"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="queue-state-s1"]')?.textContent).toBe("RECEIVED");
    expect(container.querySelector('[data-testid="queue-position-s1"]')?.textContent).toBe("#4");
  });

  it("updates a row's state live from a matching SSE event", async () => {
    mockGetMyQueue.mockResolvedValueOnce({
      submissions: [ROW({ id: "s1", state: "RECEIVED" })],
      queuePositions: { s1: 2 },
    });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    await act(async () => {
      pushEvent({ submissionId: "s1", skillName: "greet", state: "TIER2_SCANNING", timestamp: "2026-05-30T01:00:00Z" });
      await flush();
    });

    expect(container.querySelector('[data-testid="queue-state-s1"]')?.textContent).toBe("TIER2_SCANNING");
  });

  it("ignores SSE events for submissions that are not the user's own", async () => {
    mockGetMyQueue.mockResolvedValueOnce({
      submissions: [ROW({ id: "s1", state: "RECEIVED" })],
      queuePositions: { s1: 1 },
    });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    await act(async () => {
      // Event for a DIFFERENT submission id — must not add a row or mutate ours.
      pushEvent({ submissionId: "OTHER", skillName: "someone-else", state: "PUBLISHED", timestamp: "x" });
      await flush();
    });

    expect(container.querySelector('[data-testid="queue-row-OTHER"]')).toBeNull();
    expect(container.querySelector('[data-testid="queue-state-s1"]')?.textContent).toBe("RECEIVED");
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("fires the terminal-state notifier on an approved transition and clears the position", async () => {
    mockGetMyQueue.mockResolvedValueOnce({
      submissions: [ROW({ id: "s1", state: "TIER2_SCANNING" })],
      queuePositions: { s1: 1 },
    });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    await act(async () => {
      pushEvent({ submissionId: "s1", skillName: "greet", state: "PUBLISHED", timestamp: "2026-05-30T02:00:00Z" });
      await flush();
    });

    expect(notifySpy).toHaveBeenCalledWith("s1", "greet", "PUBLISHED");
    // Position column collapses to "—" once terminal (no longer queued).
    expect(container.querySelector('[data-testid="queue-position-s1"]')?.textContent).toBe("—");
  });

  it("does not double-notify when a terminal event repeats", async () => {
    mockGetMyQueue.mockResolvedValueOnce({
      submissions: [ROW({ id: "s1", state: "TIER2_SCANNING" })],
      queuePositions: { s1: 1 },
    });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    await act(async () => {
      pushEvent({ submissionId: "s1", skillName: "greet", state: "REJECTED", timestamp: "t1" });
      pushEvent({ submissionId: "s1", skillName: "greet", state: "REJECTED", timestamp: "t2" });
      await flush();
    });

    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it("skips keepalive / connected comment frames without crashing", async () => {
    mockGetMyQueue.mockResolvedValueOnce({ submissions: [ROW()], queuePositions: {} });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    await act(async () => {
      emit!({ event: "message", data: "keepalive" });
      emit!({ event: "message", data: "connected" });
      emit!({ event: "message", data: "" });
      await flush();
    });

    expect(notifySpy).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="queue-row-s1"]')).toBeTruthy();
  });

  it("renders an empty state when the user has no submissions", async () => {
    mockGetMyQueue.mockResolvedValueOnce({ submissions: [], queuePositions: {} });

    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });

    expect(container.querySelector('[data-testid="queue-empty"]')).toBeTruthy();
  });

  it("subscribes with a long timeout window (rides the 25s platform keepalive)", async () => {
    mockGetMyQueue.mockResolvedValueOnce({ submissions: [], queuePositions: {} });
    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });
    expect(lastOptions?.timeoutMs).toBeGreaterThan(30_000);
  });

  it("closes the stream on unmount", async () => {
    mockGetMyQueue.mockResolvedValueOnce({ submissions: [], queuePositions: {} });
    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });
    act(() => root.unmount());
    expect(closeSpy).toHaveBeenCalled();
    // re-create a root so afterEach unmount doesn't throw
    root = createRoot(container);
  });

  it("subscribes to the per-user (?mine=1) server-scoped stream URL", async () => {
    mockGetMyQueue.mockResolvedValueOnce({ submissions: [], queuePositions: {} });
    await act(async () => {
      root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
      await flush();
    });
    expect(lastUrl).toBe("/api/v1/submissions/stream?mine=1");
  });

  it("clean upstream close → connected goes false AND a reconnect is scheduled", async () => {
    vi.useFakeTimers();
    try {
      mockGetMyQueue.mockResolvedValueOnce({ submissions: [ROW()], queuePositions: {} });
      await act(async () => {
        root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
        await flush();
      });

      // A healthy frame flips the indicator to "Live".
      await act(async () => {
        emit!({ event: "message", data: "connected" });
        await flush();
      });
      expect(container.querySelector('[data-testid="queue-stream-status"]')?.textContent).toContain("Live");
      expect(openCount).toBe(1);

      // Server closes the stream CLEANLY (CF isolate recycle) — onClose fires.
      await act(async () => {
        lastOptions!.onClose!();
        await flush();
      });
      // Indicator drops immediately…
      expect(container.querySelector('[data-testid="queue-stream-status"]')?.textContent).toContain("Offline");

      // …and the backoff timer reconnects (opens a second stream).
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await flush();
      });
      expect(openCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT reconnect when the close is client-initiated (unmount)", async () => {
    vi.useFakeTimers();
    try {
      mockGetMyQueue.mockResolvedValueOnce({ submissions: [], queuePositions: {} });
      await act(async () => {
        root.render(<SubmissionQueuePanel openStream={fakeOpenStream} notify={notifySpy} />);
        await flush();
      });
      expect(openCount).toBe(1);

      // Unmount → cleanup sets stopped=true and calls handle.close(). The sse
      // layer would NOT fire onClose for a client close, but even if a stray
      // onClose arrives, `stopped` must prevent any reconnect.
      act(() => root.unmount());
      const onCloseAfterUnmount = lastOptions!.onClose!;
      act(() => onCloseAfterUnmount());

      await act(async () => {
        vi.advanceTimersByTime(60_000);
        await flush();
      });
      expect(openCount).toBe(1); // no reconnect after teardown

      root = createRoot(container); // re-arm root for afterEach unmount
    } finally {
      vi.useRealTimers();
    }
  });
});
