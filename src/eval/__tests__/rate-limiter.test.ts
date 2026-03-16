import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlatformRateLimiter } from "../rate-limiter.js";

// ---------------------------------------------------------------------------
// PlatformRateLimiter
// ---------------------------------------------------------------------------

describe("PlatformRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows initial requests within limit (TC-074)", async () => {
    const limiter = new PlatformRateLimiter();
    // Default limit for unknown platform is 10/min
    const acquire = limiter.acquire("unknown_platform");
    vi.advanceTimersByTime(0);
    await acquire;
    // Should resolve immediately
  });

  it("uses default rate limit for unknown platforms (TC-074)", () => {
    const limiter = new PlatformRateLimiter();
    const limit = limiter.getLimit("some_random_platform");
    expect(limit.requestsPerMinute).toBe(10);
  });

  it("uses configured rate limits for known platforms", () => {
    const limiter = new PlatformRateLimiter();
    expect(limiter.getLimit("x").requestsPerMinute).toBe(3);
    expect(limiter.getLimit("linkedin").requestsPerMinute).toBe(2);
    expect(limiter.getLimit("slack").requestsPerMinute).toBe(10);
  });

  it("applies custom overrides", () => {
    const limiter = new PlatformRateLimiter({
      x: { requestsPerMinute: 1 },
    });
    expect(limiter.getLimit("x").requestsPerMinute).toBe(1);
  });

  it("delays requests when rate limit exhausted (TC-073)", async () => {
    const limiter = new PlatformRateLimiter({
      testplatform: { requestsPerMinute: 2 },
    });

    // First 2 should be immediate
    await limiter.acquire("testplatform");
    await limiter.acquire("testplatform");

    // 3rd should wait
    let thirdResolved = false;
    const thirdPromise = limiter.acquire("testplatform").then(() => {
      thirdResolved = true;
    });

    // Not resolved yet
    await vi.advanceTimersByTimeAsync(0);
    expect(thirdResolved).toBe(false);

    // Advance past refill interval (60s / 2 = 30s)
    await vi.advanceTimersByTimeAsync(30_000);
    await thirdPromise;
    expect(thirdResolved).toBe(true);
  });
});
