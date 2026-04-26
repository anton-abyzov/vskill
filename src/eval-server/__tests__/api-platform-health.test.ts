// ---------------------------------------------------------------------------
// 0778 US-001 — computePlatformHealth: degraded gating, fallback, cache TTL.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computePlatformHealth,
  resetPlatformHealthCache,
} from "../api-routes.js";

function makeFetch(stats: unknown, queue: unknown, opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    if (opts.fail) throw new Error("network down");
    if (url.includes("submissions/stats")) {
      return new Response(JSON.stringify(stats), { status: 200 });
    }
    if (url.includes("queue/health")) {
      return new Response(JSON.stringify(queue), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("computePlatformHealth (0778 US-001)", () => {
  beforeEach(() => resetPlatformHealthCache());
  afterEach(() => resetPlatformHealthCache());

  it("AC-US1-01/02: healthy upstream → degraded:false, reason null", async () => {
    const { f } = makeFetch(
      { degraded: false },
      { statsAge: { ageMs: 5_000 }, oldestActive: { ageMs: 30_000 } },
    );
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.statsAgeMs).toBe(5_000);
    expect(r.oldestActiveAgeMs).toBe(30_000);
  });

  it("AC-US1-02 (a): platform reports degraded → degraded:true with reason mentions 'degraded'", async () => {
    const { f } = makeFetch(
      { degraded: true },
      { statsAge: { ageMs: 100 }, oldestActive: { ageMs: 100 } },
    );
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain("platform reports degraded");
  });

  it("AC-US1-02 (b): heartbeat stale > 30min → degraded:true with 'heartbeat stale'", async () => {
    const { f } = makeFetch(
      { degraded: false },
      { statsAge: { ageMs: 2 * 60 * 60 * 1000 + 4 * 60 * 1000 }, oldestActive: { ageMs: 100 } },
    );
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain("heartbeat stale");
    expect(r.reason).toMatch(/2h 4m|2h/);
  });

  it("AC-US1-02 (c): oldest active > 24h → degraded:true with 'oldest active submission'", async () => {
    const { f } = makeFetch(
      { degraded: false },
      { statsAge: { ageMs: 100 }, oldestActive: { ageMs: 31 * 24 * 60 * 60 * 1000 } },
    );
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(true);
    expect(r.reason).toContain("oldest active submission");
    expect(r.reason).toContain("31d");
  });

  it("AC-US1-02: multiple signals → reason joins all", async () => {
    const { f } = makeFetch(
      { degraded: true },
      { statsAge: { ageMs: 2 * 60 * 60 * 1000 }, oldestActive: { ageMs: 31 * 24 * 60 * 60 * 1000 } },
    );
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.reason).toContain("platform reports degraded");
    expect(r.reason).toContain("heartbeat stale");
    expect(r.reason).toContain("oldest active submission");
  });

  it("AC-US1-03: upstream throws → safe fallback, never throws", async () => {
    const { f } = makeFetch({}, {}, { fail: true });
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(false);
    expect(r.reason).toBe("platform-unreachable");
    expect(r.statsAgeMs).toBe(0);
    expect(r.oldestActiveAgeMs).toBe(0);
  });

  it("AC-US1-03: upstream returns malformed JSON → safe fallback", async () => {
    const f = vi.fn(async () => new Response("not json{", { status: 200 })) as unknown as typeof fetch;
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(false);
    expect(r.reason).toBe("platform-unreachable");
  });

  it("AC-US1-03: upstream non-2xx → safe fallback", async () => {
    const f = vi.fn(async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const r = await computePlatformHealth({ fetchImpl: f, skipCache: true });
    expect(r.degraded).toBe(false);
    expect(r.reason).toBe("platform-unreachable");
  });

  it("AC-US1-04: 60s cache — second call within window does NOT re-fetch", async () => {
    const { f, calls } = makeFetch(
      { degraded: false },
      { statsAge: { ageMs: 100 }, oldestActive: { ageMs: 100 } },
    );
    await computePlatformHealth({ fetchImpl: f });
    const callsAfterFirst = calls.length;
    await computePlatformHealth({ fetchImpl: f });
    expect(calls.length).toBe(callsAfterFirst); // no new calls
  });
});
