// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { SEEN_LAST_ID_KEY, updateStore } from "../../stores/updateStore";
import type { SkillUpdateEvent } from "../../types/skill-update";

// ---------------------------------------------------------------------------
// MockEventSource — instances are tracked in `esInstances` so tests can drive
// onmessage/onerror/custom `gone` dispatch deterministically.
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

function fireError(es: MockES): void {
  es.readyState = 0;
  es.onerror?.(new Event("error"));
}

function fireGone(es: MockES, reason = "too-old"): void {
  const cbs = es.listeners.get("gone") ?? [];
  const msg = new MessageEvent("gone", { data: JSON.stringify({ reason }) });
  for (const cb of cbs) cb(msg);
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

// Mock the api module so polling path + check-updates are observable.
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
    api() {
      return apiRef.current!;
    },
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

describe("useSkillUpdates — SSE push pipeline (0708)", () => {
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

  // -------------------------------------------------------------------------
  // T-029/T-030: EventSource lifecycle + update store + reconnect (AC-US5-01)
  // -------------------------------------------------------------------------

  describe("T-029/T-030: lifecycle + filter (AC-US5-01, AC-US5-08)", () => {
    it("opens an EventSource with ?skills=<sorted-csv> from installed list", async () => {
      const h = await mountHook({ skillIds: ["skill-B", "skill-A"] });
      try {
        expect(esInstances.length).toBe(1);
        const url = new URL(latestES().url, "http://localhost");
        expect(url.pathname).toMatch(/\/skills\/stream$/);
        expect(url.searchParams.get("skills")).toBe("skill-A,skill-B");
      } finally {
        h.unmount();
      }
    });

    it("exposes status progression: connecting → connected on open", async () => {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        expect(h.api().status).toBe("connecting");
        await h.act(async () => {
          fireOpen(latestES());
          await flushMicrotasks();
        });
        expect(h.api().status).toBe("connected");
      } finally {
        h.unmount();
      }
    });

    it("dispatches SSE skill.updated events into the update store", async () => {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), mkEvent(1, "skill-A"));
          await flushMicrotasks();
        });
        const entry = h.api().updatesById.get("skill-A");
        expect(entry?.version).toBe("1.1.0");
        expect(h.api().pushUpdateCount).toBe(1);
      } finally {
        h.unmount();
      }
    });

    it("reconnects on onerror (browser auto-reconnect) without losing the filter", async () => {
      const h = await mountHook({ skillIds: ["skill-A", "skill-B"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          await flushMicrotasks();
        });
        const firstUrl = latestES().url;
        await h.act(async () => {
          fireError(latestES());
          vi.advanceTimersByTime(500);
          await flushMicrotasks();
        });
        // Either same instance (browser auto-reconnect) or new instance —
        // either way the filter must be preserved in the live URL.
        const active = esInstances[esInstances.length - 1];
        const url = new URL(active.url, "http://localhost");
        expect(url.searchParams.get("skills")).toBe("skill-A,skill-B");
        expect(decodeURIComponent(firstUrl)).toContain("skill-A,skill-B");
      } finally {
        h.unmount();
      }
    });

    it("reopens the EventSource when the skillIds filter changes", async () => {
      const { useState } = await import("react");
      const React = await import("react");
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { useSkillUpdates } = await import("../useSkillUpdates");

      let setIds: ((ids: string[]) => void) | null = null;
      function Probe() {
        const [ids, s] = useState<string[]>(["skill-A"]);
        setIds = s;
        useSkillUpdates({ skillIds: ids });
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(React.createElement(Probe));
      });
      try {
        expect(esInstances.length).toBe(1);
        expect(new URL(esInstances[0].url, "http://localhost").searchParams.get("skills")).toBe("skill-A");
        await act(async () => {
          setIds!(["skill-A", "skill-C"]);
          await flushMicrotasks();
        });
        expect(esInstances.length).toBe(2);
        expect(new URL(esInstances[1].url, "http://localhost").searchParams.get("skills")).toBe("skill-A,skill-C");
        expect(esInstances[0]._closed).toBe(true);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  });

  // -------------------------------------------------------------------------
  // T-031/T-032: visibility-gated toast vs silent badge (AC-US5-02)
  // -------------------------------------------------------------------------

  describe("T-031/T-032: visibility gating (AC-US5-02, AC-US5-07)", () => {
    it("dispatches studio:toast when visible on event arrival; badge still increments", async () => {
      const toasts: Array<{ message: string; severity: string }> = [];
      const listener = (e: Event) => {
        if (!(e instanceof CustomEvent)) return;
        toasts.push(e.detail);
      };
      window.addEventListener("studio:toast", listener);
      try {
        const h = await mountHook({ skillIds: ["skill-A"] });
        try {
          await h.act(async () => {
            fireOpen(latestES());
            fireMessage(latestES(), mkEvent(1, "skill-A"));
            await flushMicrotasks();
          });
          expect(toasts.length).toBe(1);
          expect(toasts[0].message).toContain("1.1.0");
          expect(h.api().pushUpdateCount).toBe(1);
        } finally {
          h.unmount();
        }
      } finally {
        window.removeEventListener("studio:toast", listener);
      }
    });

    it("suppresses toast when hidden; badge still increments", async () => {
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
        } finally {
          h.unmount();
        }
      } finally {
        window.removeEventListener("studio:toast", listener);
      }
    });
  });

  // -------------------------------------------------------------------------
  // T-033/T-034: 60s disconnect → poll fallback (AC-US5-05)
  // -------------------------------------------------------------------------

  describe("T-033/T-034: 60s disconnect fallback (AC-US5-05, AC-US5-07)", () => {
    it("flips status to 'fallback' after 60s of sustained disconnect", async () => {
      const h = await mountHook({ skillIds: ["skill-A"], disconnectFallbackMs: 60_000 });
      try {
        // Never fire onopen — simulate connection that never succeeds.
        await h.act(async () => {
          fireError(latestES());
          await flushMicrotasks();
        });
        expect(h.api().status).toBe("connecting");
        await h.act(async () => {
          vi.advanceTimersByTime(60_000);
          await flushMicrotasks();
        });
        expect(h.api().status).toBe("fallback");
      } finally {
        h.unmount();
      }
    });

    it("returns to 'connected' when a later EventSource.onopen succeeds", async () => {
      const h = await mountHook({ skillIds: ["skill-A"], disconnectFallbackMs: 60_000 });
      try {
        await h.act(async () => {
          fireError(latestES());
          vi.advanceTimersByTime(60_000);
          await flushMicrotasks();
        });
        expect(h.api().status).toBe("fallback");
        // A later reconnect succeeds.
        await h.act(async () => {
          fireOpen(latestES());
          await flushMicrotasks();
        });
        expect(h.api().status).toBe("connected");
      } finally {
        h.unmount();
      }
    });
  });

  // -------------------------------------------------------------------------
  // T-058/T-059: gone-frame reconciliation (AC-US5-11)
  // -------------------------------------------------------------------------

  describe("T-058/T-059: gone-frame + 409 fallback (AC-US5-11)", () => {
    it("on gone event: clears seenLastId, calls checkSkillUpdates, merges response", async () => {
      checkUpdatesSpy.mockResolvedValue([
        { skillId: "skill-A", version: "2.0.0", eventId: "evt_recon_A", publishedAt: "2026-01-01T00:00:00Z", diffSummary: "recon" },
      ]);
      window.localStorage.setItem(SEEN_LAST_ID_KEY, "evt_before_gone");
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        await h.act(async () => {
          fireOpen(latestES());
          fireGone(latestES(), "too-old");
          await flushMicrotasks();
          await flushMicrotasks();
        });
        // 0708 wrap-up: the hook now also fires `checkSkillUpdates` on mount
        // for tracking-state reconciliation (AC-US5-09). The gone-frame path
        // adds a second call, so we assert the spy was called at least twice
        // and that one of those calls carried the gone-event skill list.
        expect(checkUpdatesSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        const calledWithA = checkUpdatesSpy.mock.calls.some(
          (c) => Array.isArray(c[0]) && c[0].length === 1 && c[0][0] === "skill-A",
        );
        expect(calledWithA).toBe(true);
        expect(h.api().updatesById.get("skill-A")?.version).toBe("2.0.0");
        // seenLastId was wiped (AC-US5-11).
        expect(window.localStorage.getItem(SEEN_LAST_ID_KEY)).toBeNull();
        // Status remains connected — gone is silent.
        expect(h.api().status).toBe("connected");
      } finally {
        h.unmount();
      }
    });

    it("does not fire a toast during gone-frame reconciliation", async () => {
      checkUpdatesSpy.mockResolvedValue([
        { skillId: "skill-A", version: "2.0.0", eventId: "evt_recon_A", publishedAt: "2026-01-01T00:00:00Z" },
      ]);
      const toasts: unknown[] = [];
      const listener = (e: Event) => toasts.push(e);
      window.addEventListener("studio:toast", listener);
      try {
        const h = await mountHook({ skillIds: ["skill-A"] });
        try {
          await h.act(async () => {
            fireOpen(latestES());
            fireGone(latestES());
            await flushMicrotasks();
            await flushMicrotasks();
          });
          expect(toasts.length).toBe(0);
        } finally {
          h.unmount();
        }
      } finally {
        window.removeEventListener("studio:toast", listener);
      }
    });
  });

  // -------------------------------------------------------------------------
  // T-056/T-057: live-stream dedup via seenEventIds (AC-US5-10)
  // -------------------------------------------------------------------------

  describe("T-056/T-057: live-stream dedup (AC-US5-10)", () => {
    it("drops duplicate SSE events silently", async () => {
      const h = await mountHook({ skillIds: ["skill-A"] });
      try {
        const evt = mkEvent(1, "skill-A");
        await h.act(async () => {
          fireOpen(latestES());
          fireMessage(latestES(), evt);
          await flushMicrotasks();
        });
        expect(h.api().pushUpdateCount).toBe(1);
        const entry1 = h.api().updatesById.get("skill-A");
        // Replay — second onmessage with the same eventId.
        await h.act(async () => {
          fireMessage(latestES(), evt);
          await flushMicrotasks();
        });
        expect(h.api().pushUpdateCount).toBe(1);
        // The store entry identity should not have been replaced (no notify).
        expect(h.api().updatesById.get("skill-A")).toBe(entry1);
      } finally {
        h.unmount();
      }
    });
  });
});
