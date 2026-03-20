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
        verdict: "PASS",
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
            { provider: "semgrep", status: "FAIL", verdict: "FAIL", criticalCount: 3 },
            { provider: "snyk", status: "PASS", verdict: "PASS", criticalCount: 0 },
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

  it("returns overallVerdict PENDING when providers array is empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "CERTIFIED",
          providers: [],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("empty-scan");

    expect(result).not.toBeNull();
    expect(result!.overallVerdict).toBe("PENDING");
    expect(result!.providers).toHaveLength(0);
    expect(result!.hasCritical).toBe(false);
  });

  it("normalizes lowercase status/verdict strings to uppercase", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "fail",
          providers: [
            { provider: "semgrep", status: "fail", verdict: "concerns", criticalCount: 1 },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("lowercase-skill");

    expect(result).not.toBeNull();
    expect(result!.overallVerdict).toBe("FAIL");
    expect(result!.providers[0].status).toBe("FAIL");
    expect(result!.providers[0].verdict).toBe("CONCERNS");
  });

  it("falls back invalid enum values to PENDING", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "BOGUS",
          providers: [
            { provider: "semgrep", status: "INVALID", verdict: "NOPE", criticalCount: 0 },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("invalid-enums");

    expect(result).not.toBeNull();
    expect(result!.overallVerdict).toBe("PENDING");
    expect(result!.providers[0].status).toBe("PENDING");
    expect(result!.providers[0].verdict).toBe("PENDING");
  });

  it("treats non-numeric criticalCount as 0", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "FAIL",
          providers: [
            { provider: "semgrep", status: "FAIL", verdict: "FAIL", criticalCount: "N/A" },
            { provider: "snyk", status: "FAIL", verdict: "FAIL", criticalCount: undefined },
          ],
        }),
    }) as unknown as typeof fetch;

    const result = await checkPlatformSecurity("nan-counts");

    expect(result).not.toBeNull();
    expect(result!.providers[0].criticalCount).toBe(0);
    expect(result!.providers[1].criticalCount).toBe(0);
    // NaN criticalCount means hasCritical should be false (0 > 0 is false)
    expect(result!.hasCritical).toBe(false);
  });

  it("warns when safeNumber coerces non-numeric criticalCount to fallback", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          providers: [
            { provider: "semgrep", status: "PASS", verdict: "PASS", criticalCount: "N/A" },
          ],
        }),
    }) as unknown as typeof fetch;

    await checkPlatformSecurity("warn-nan");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[platform-security]"),
      "N/A",
    );
    warnSpy.mockRestore();
  });

  it("warns when validateEnum falls back on invalid enum value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () =>
        makePlatformResponse({
          overallVerdict: "BOGUS",
          providers: [
            { provider: "semgrep", status: "GARBAGE", verdict: "NOPE", criticalCount: 0 },
          ],
        }),
    }) as unknown as typeof fetch;

    await checkPlatformSecurity("warn-enum");

    // Should warn for invalid status, verdict, and overallVerdict
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("GARBAGE"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("NOPE"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("BOGUS"),
    );
    warnSpy.mockRestore();
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
