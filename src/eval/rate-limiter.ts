// ---------------------------------------------------------------------------
// rate-limiter.ts -- per-platform token bucket rate limiter
// ---------------------------------------------------------------------------

import type { PlatformRateLimit } from "./integration-types.js";
import { DEFAULT_RATE_LIMITS, DEFAULT_RATE_LIMIT } from "./integration-types.js";

interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillIntervalMs: number;
  lastRefill: number;
}

/**
 * Per-platform token bucket rate limiter for integration tests.
 * Ensures requests to external platforms stay within configured limits.
 */
export class PlatformRateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private overrides: Record<string, PlatformRateLimit>;

  constructor(overrides?: Record<string, PlatformRateLimit>) {
    this.overrides = overrides ?? {};
  }

  /**
   * Acquire a token for the given platform. Waits if no tokens available.
   */
  async acquire(platform: string): Promise<void> {
    const bucket = this.getBucket(platform);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = bucket.refillIntervalMs - (Date.now() - bucket.lastRefill);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
    this.refill(bucket);
    bucket.tokens = Math.max(0, bucket.tokens - 1);
  }

  /**
   * Get rate limit config for a platform.
   */
  getLimit(platform: string): PlatformRateLimit {
    return this.overrides[platform] ?? DEFAULT_RATE_LIMITS[platform] ?? DEFAULT_RATE_LIMIT;
  }

  private getBucket(platform: string): TokenBucket {
    let bucket = this.buckets.get(platform);
    if (!bucket) {
      const limit = this.getLimit(platform);
      const refillIntervalMs = (60_000 / limit.requestsPerMinute);
      bucket = {
        tokens: limit.requestsPerMinute,
        maxTokens: limit.requestsPerMinute,
        refillIntervalMs,
        lastRefill: Date.now(),
      };
      this.buckets.set(platform, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor(elapsed / bucket.refillIntervalMs);
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }
  }
}
