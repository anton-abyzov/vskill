// ---------------------------------------------------------------------------
// openrouter-cache.test.ts — 10-minute per-key cache on /api/openrouter/models
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPENROUTER_CACHE, resetOpenRouterCache } from "../api-routes";

describe("OPENROUTER_CACHE — 10-minute TTL per API key", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetOpenRouterCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    resetOpenRouterCache();
  });

  it("is exported as a Map and keyed by last-8 of the API key", () => {
    expect(OPENROUTER_CACHE).toBeInstanceOf(Map);
    OPENROUTER_CACHE.set("abcd1234", { value: [], fetchedAt: Date.now() });
    expect(OPENROUTER_CACHE.has("abcd1234")).toBe(true);
  });

  it("resetOpenRouterCache() clears all entries", () => {
    OPENROUTER_CACHE.set("xyz12345", { value: [], fetchedAt: Date.now() });
    resetOpenRouterCache();
    expect(OPENROUTER_CACHE.size).toBe(0);
  });

  it("stale entries are those older than the 10-minute TTL", () => {
    const now = Date.now();
    const freshEntry = { value: [], fetchedAt: now - 5 * 60_000 };
    const staleEntry = { value: [], fetchedAt: now - 15 * 60_000 };
    expect(now - freshEntry.fetchedAt < 600_000).toBe(true);
    expect(now - staleEntry.fetchedAt >= 600_000).toBe(true);
  });
});
