// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueue,
  drain,
  peek,
  clear,
  STORAGE_KEY,
  MAX_ENTRIES,
  STALE_AFTER_MS,
  type QueuedToast,
} from "../toastQueue";

function makeEntry(eventId: string, ts = Date.now()): QueuedToast {
  return {
    message: `${eventId} updated`,
    severity: "info",
    skillId: "skill-A",
    version: "1.0.0",
    eventId,
    enqueuedAt: ts,
  };
}

describe("toastQueue (T-005)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("FIFO eviction: enqueueing 11 entries leaves 10 with the oldest dropped", () => {
    for (let i = 0; i < 11; i++) {
      enqueue(makeEntry(`evt_${String(i).padStart(2, "0")}`));
    }
    const entries = peek();
    expect(entries.length).toBe(MAX_ENTRIES);
    // The oldest one (evt_00) should have been evicted; evt_01..evt_10 remain.
    expect(entries[0].eventId).toBe("evt_01");
    expect(entries[entries.length - 1].eventId).toBe("evt_10");
  });

  it("drains entries that are not stale", () => {
    enqueue(makeEntry("evt_01"));
    enqueue(makeEntry("evt_02"));
    const drained = drain();
    expect(drained.length).toBe(2);
    expect(drained.map((d) => d.eventId)).toEqual(["evt_01", "evt_02"]);
    // Queue is empty after drain.
    expect(peek().length).toBe(0);
  });

  it("drops entries older than STALE_AFTER_MS at drain time silently", () => {
    const t0 = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(t0);
    enqueue(makeEntry("evt_old", t0));
    // Advance past STALE_AFTER_MS + 1 ms.
    vi.setSystemTime(t0 + STALE_AFTER_MS + 1);
    enqueue(makeEntry("evt_fresh", t0 + STALE_AFTER_MS + 1));
    const drained = drain();
    expect(drained.length).toBe(1);
    expect(drained[0].eventId).toBe("evt_fresh");
  });

  it("dedupes by eventId — second enqueue with the same eventId is ignored", () => {
    enqueue(makeEntry("evt_dup"));
    enqueue(makeEntry("evt_dup"));
    enqueue(makeEntry("evt_other"));
    const entries = peek();
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.eventId)).toEqual(["evt_dup", "evt_other"]);
  });

  it("clear() empties the queue", () => {
    enqueue(makeEntry("evt_a"));
    enqueue(makeEntry("evt_b"));
    clear();
    expect(peek().length).toBe(0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is SSR-safe: enqueue is a no-op when window is undefined", async () => {
    // Tear down window for this assertion only.
    const realWindow = globalThis.window;
    // @ts-expect-error: deliberately unsetting for test.
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(() => enqueue(makeEntry("evt_ssr"))).not.toThrow();
      expect(() => drain()).not.toThrow();
      expect(() => peek()).not.toThrow();
      expect(drain()).toEqual([]);
    } finally {
      (globalThis as { window?: unknown }).window = realWindow;
    }
  });

  it("recovers gracefully when localStorage payload is malformed", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(() => peek()).not.toThrow();
    expect(peek()).toEqual([]);
    // Subsequent enqueue still works
    enqueue(makeEntry("evt_recover"));
    expect(peek().length).toBe(1);
  });

  it("persists across reload — entries written to localStorage survive a fresh peek", () => {
    enqueue(makeEntry("evt_persist"));
    // Simulate a "reload" by clearing in-memory state and re-reading.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(peek().map((e) => e.eventId)).toEqual(["evt_persist"]);
  });
});
