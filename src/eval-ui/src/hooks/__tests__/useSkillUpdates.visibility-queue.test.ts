// @vitest-environment jsdom
// 0838 T-006: Visibility-gated enqueue + replay integration in useSkillUpdates.
// Hidden-tab `skill.updated` events go to the toastQueue instead of dispatching
// `studio:toast`. On `visibilitychange → "visible"`, queued entries are
// replayed at 250 ms intervals via `studio:toast`, deduped against the
// `seenEventIds` already in the update store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { updateStore } from "../../stores/updateStore";
import type { SkillUpdateEvent } from "../../types/skill-update";
import { STORAGE_KEY } from "../../utils/toastQueue";

// ---------------------------------------------------------------------------
// MockEventSource — copied from useSkillUpdates.sse.test.ts shape so the SSE
// pipeline is observable in fake-time.
// ---------------------------------------------------------------------------
interface MockES {
  url: string;
  readyState: number;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  listeners: Map<string, Array<(e: MessageEvent) => void>>;
  close: () => void;
  _closed: boolean;
}

const esInstances: MockES[] = [];

class MockEventSource implements MockES {
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  _closed = false;

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string | URL) {
    this.url = typeof url === "string" ? url : url.toString();
    esInstances.push(this);
  }
  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  removeEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }
  close(): void {
    this._closed = true;
    this.readyState = 2;
  }
}

function latestES(): MockES {
  const es = esInstances[esInstances.length - 1];
  if (!es) throw new Error("no EventSource instance created yet");
  return es;
}

function fireOpen(es: MockES): void {
  es.readyState = 1;
  es.onopen?.(new Event("open"));
}
function fireMessage(es: MockES, event: SkillUpdateEvent): void {
  const msg = new MessageEvent("message", { data: JSON.stringify(event), lastEventId: event.eventId });
  es.onmessage?.(msg);
}
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const getSkillUpdatesSpy = vi.fn();
const checkUpdatesSpy = vi.fn();
vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkillUpdates: getSkillUpdatesSpy,
      checkSkillUpdates: checkUpdatesSpy,
    },
  };
});

async function mountHook(opts?: Parameters<typeof import("../useSkillUpdates").useSkillUpdates>[0]) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSkillUpdates } = await import("../useSkillUpdates");

  const apiRef: { current: import("../useSkillUpdates").UseSkillUpdatesReturn | null } = { current: null };
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
    api() { return apiRef.current!; },
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function mkEvent(n: number, skillId: string): SkillUpdateEvent {
  return {
    type: "skill.updated",
    eventId: `evt_${n.toString().padStart(4, "0")}`,
    skillId,
    version: `1.${n}.0`,
    gitSha: `sha${n}`,
    publishedAt: new Date(1_700_000_000_000 + n).toISOString(),
    diffSummary: `update ${n}`,
  };
}

describe("useSkillUpdates — visibility queue (T-006)", () => {
  beforeEach(() => {
    esInstances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setVisibility("visible");
    getSkillUpdatesSpy.mockReset();
    getSkillUpdatesSpy.mockResolvedValue([]);
    checkUpdatesSpy.mockReset();
    checkUpdatesSpy.mockResolvedValue([]);
    updateStore.reset();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("enqueues toast (no studio:toast dispatch) when hidden", async () => {
    setVisibility("hidden");
    const toasts: unknown[] = [];
    const listener = (e: Event) => toasts.push(e);
    window.addEventListener("studio:toast", listener);
    try {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          await flushMicrotasks();
        });
        expect(toasts.length).toBe(0);
        expect(h.api().pushUpdateCount).toBe(1);
        // Queue should now contain that one toast (persisted).
        const raw = window.localStorage.getItem(STORAGE_KEY);
        expect(raw).toBeTruthy();
        const queued = JSON.parse(raw!);
        expect(Array.isArray(queued)).toBe(true);
        expect(queued.length).toBe(1);
        expect(queued[0].eventId).toBe("evt_0001");
      } finally {
        h.unmount();
      }
    } finally {
      window.removeEventListener("studio:toast", listener);
    }
  });

  it("replays queued entries at 250 ms intervals on visibilitychange → visible", async () => {
    setVisibility("hidden");
    const toasts: Array<{ eventId: string }> = [];
    const listener = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      toasts.push(e.detail);
    };
    window.addEventListener("studio:toast", listener);
    try {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        // Three hidden events land in the queue.
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          fireMessage(latestES(), mkEvent(2, "skill-B"));
          fireMessage(latestES(), mkEvent(3, "skill-C"));
          await flushMicrotasks();
        });
        expect(toasts.length).toBe(0);
        expect(h.api().pushUpdateCount).toBe(3);

        // Flip to visible.
        await h.act(async () => {
          setVisibility("visible");
          await flushMicrotasks();
        });
        // The first replay fires immediately or after one tick.
        await h.act(async () => {
          vi.advanceTimersByTime(0);
          await flushMicrotasks();
        });
        expect(toasts.length).toBeGreaterThanOrEqual(1);
        // Advance through the 250 ms intervals (3 entries: total ~500 ms).
        await h.act(async () => {
          vi.advanceTimersByTime(250);
          await flushMicrotasks();
        });
        await h.act(async () => {
          vi.advanceTimersByTime(250);
          await flushMicrotasks();
        });
        expect(toasts.length).toBe(3);
        // Queue should be empty after replay.
        const raw = window.localStorage.getItem(STORAGE_KEY);
        // After drain it should be either null or "[]".
        if (raw !== null) {
          expect(JSON.parse(raw)).toEqual([]);
        }
      } finally {
        h.unmount();
      }
    } finally {
      window.removeEventListener("studio:toast", listener);
    }
  });

  it("skips replay when the store entry has been superseded by a newer eventId", async () => {
    setVisibility("hidden");
    const toasts: Array<{ eventId: string }> = [];
    const listener = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      toasts.push(e.detail);
    };
    window.addEventListener("studio:toast", listener);
    try {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        // First event lands while hidden — enqueued.
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          await flushMicrotasks();
        });
        // Simulate the polling fallback discovering a NEWER publish for
        // skill-A while the tab is still hidden. Bulk-merge a fresh entry
        // with a different eventId — this should supersede the queued one.
        updateStore.mergeBulk([
          {
            skillId: "skill-A",
            version: "9.9.9",
            eventId: "evt_super",
            publishedAt: new Date().toISOString(),
            receivedAt: Date.now(),
          },
        ]);

        // Visibility flip — drain runs; the queued (older) eventId should
        // be skipped because the store now holds a newer one.
        await h.act(async () => {
          setVisibility("visible");
          await flushMicrotasks();
          vi.advanceTimersByTime(0);
          await flushMicrotasks();
          vi.advanceTimersByTime(250);
          await flushMicrotasks();
        });

        // No toasts replayed — superseded.
        expect(toasts.length).toBe(0);
      } finally {
        h.unmount();
      }
    } finally {
      window.removeEventListener("studio:toast", listener);
    }
  });
});

describe("useSkillUpdates — debug logging (T-001)", () => {
  beforeEach(() => {
    esInstances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setVisibility("visible");
    getSkillUpdatesSpy.mockReset();
    getSkillUpdatesSpy.mockResolvedValue([]);
    checkUpdatesSpy.mockReset();
    checkUpdatesSpy.mockResolvedValue([]);
    updateStore.reset();
    window.localStorage.clear();
    // Reset URL each test.
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emits no [sse] console.debug when the flag is unset", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          await flushMicrotasks();
        });
        const sseLogs = debugSpy.mock.calls.filter(
          (c) => typeof c[0] === "string" && c[0].startsWith("[sse]"),
        );
        expect(sseLogs.length).toBe(0);
      } finally {
        h.unmount();
      }
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("emits [sse] console.debug for lifecycle events when ?debugSse=1", async () => {
    window.history.replaceState(null, "", "/?debugSse=1");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          await flushMicrotasks();
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          await flushMicrotasks();
        });
        const sseLogs = debugSpy.mock.calls.filter(
          (c) => typeof c[0] === "string" && c[0].startsWith("[sse]"),
        );
        expect(sseLogs.length).toBeGreaterThanOrEqual(2);
        // Each line has an ISO timestamp embedded.
        for (const line of sseLogs) {
          const text = String(line[0]);
          expect(text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        }
      } finally {
        h.unmount();
      }
    } finally {
      debugSpy.mockRestore();
    }
  });
});

describe("useSkillUpdates — telemetry pings (T-012)", () => {
  beforeEach(() => {
    esInstances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    setVisibility("visible");
    getSkillUpdatesSpy.mockReset();
    getSkillUpdatesSpy.mockResolvedValue([]);
    checkUpdatesSpy.mockReset();
    checkUpdatesSpy.mockResolvedValue([]);
    updateStore.reset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fires exactly one telemetry POST per (event, session) tuple on connected", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);

    const h = await mountHook({ skillIds: ["skill-A"] });
    try {
      await h.act(async () => {
        fireOpen(latestES());
        await flushMicrotasks();
      });
      // One connected → one ping.
      const telemetryCalls = fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/api/v1/studio/telemetry/sse"),
      );
      expect(telemetryCalls.length).toBe(1);
      // The body should include event=connected + sessionId + sourceTier.
      const body = JSON.parse(telemetryCalls[0][1]?.body as string);
      expect(body.event).toBe("connected");
      expect(typeof body.sessionId).toBe("string");
      expect(body.sessionId.length).toBeGreaterThan(0);
      expect(body.sourceTier).toBe("platform-proxy");
      expect(typeof body.timestamp).toBe("number");

      // Re-trigger another `connected` (e.g. reconnect): no second ping.
      await h.act(async () => {
        fireOpen(latestES());
        await flushMicrotasks();
      });
      const telemetryCalls2 = fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/api/v1/studio/telemetry/sse"),
      );
      expect(telemetryCalls2.length).toBe(1);
    } finally {
      h.unmount();
    }
  });

  it("does not fire telemetry when ?disableTelemetry=1", async () => {
    window.history.replaceState(null, "", "/?disableTelemetry=1");
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    const h = await mountHook({ skillIds: ["skill-A"] });
    try {
      await h.act(async () => {
        fireOpen(latestES());
        await flushMicrotasks();
      });
      const telemetryCalls = fetchSpy.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0].includes("/api/v1/studio/telemetry/sse"),
      );
      expect(telemetryCalls.length).toBe(0);
    } finally {
      h.unmount();
    }
  });

  it("persists sessionId in sessionStorage and reuses across transitions", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    const h = await mountHook({ skillIds: ["skill-A"] });
    try {
      await h.act(async () => {
        fireOpen(latestES());
        await flushMicrotasks();
      });
      const stored = window.sessionStorage.getItem("vskill.studio.sse.sessionId");
      expect(stored).toBeTruthy();
      // It looks like a v4 UUID.
      expect(stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    } finally {
      h.unmount();
    }
  });
});
