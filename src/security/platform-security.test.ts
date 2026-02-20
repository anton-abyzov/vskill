import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkPlatformSecurity } from "./platform-security.js";

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlatformResponse(overrides: Record<string, unknown> = {}) {
  return {
    overallVerdict: "PASS",
    reportUrl: "/skills/test-skill/security",
    providers: [
      {
        provider: "semgrep",
        status: "PASS",
        verdict: "clean",
        criticalCount: 0,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkPlatformSecurity", () => {
  it("returns hasCritical: true when a provider has FAIL + criticalCount > 0", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "FAIL",
          providers: [
            { provider: "semgrep", status: "FAIL", verdict: "critical", criticalCount: 3 },
            { provider: "snyk", status: "PASS", verdict: "clean", criticalCount: 0 },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("evil-skill");

    expect(result).not.toBeNull();
    expect(result!.hasCritical).toBe(true);
    expect(result!.overallVerdict).toBe("FAIL");
    expect(result!.providers).toHaveLength(2);
    expect(result!.providers[0].criticalCount).toBe(3);
  });

  it("returns hasCritical: false when all providers PASS", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePlatformResponse(),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("safe-skill");

    expect(result).not.toBeNull();
    expect(result!.hasCritical).toBe(false);
    expect(result!.overallVerdict).toBe("PASS");
  });

  it("returns null on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error("Network unreachable"),
    ) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("any-skill");

    expect(result).toBeNull();
  });

  it("returns null on 404 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("unknown-skill");

    expect(result).toBeNull();
  });

  it("returns hasCritical: false when status is PENDING (does not block)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "PENDING",
          providers: [
            { provider: "semgrep", status: "PENDING", verdict: null, criticalCount: 0 },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("pending-skill");

    expect(result).not.toBeNull();
    expect(result!.hasCritical).toBe(false);
    expect(result!.overallVerdict).toBe("PENDING");
  });
});
