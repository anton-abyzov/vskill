// ---------------------------------------------------------------------------
// 0710 T-001 — server-side TDD gate:
//   Verifies /api/openrouter/models canonicalizes upstream USD-per-token
//   pricing to USD-per-1M-tokens before storing in cache and returning to
//   clients. Matches the wire contract established by 0701 for the Anthropic
//   side (api-routes.ts:648-651) so all consumers can assume one unit.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Fake-router pattern (mirrors version-routes.test.ts) — capture the handlers
// registerRoutes wires up so we can invoke /api/openrouter/models in-process.
// ---------------------------------------------------------------------------

const { registerRoutes, resetOpenRouterCache, OPENROUTER_CACHE } = await import(
  "../api-routes.js"
);

function captureGetHandler(path: string): (req: any, res: any) => Promise<void> {
  const handlers: Record<string, any> = {};
  const fakeRouter = {
    get: vi.fn((p: string, handler: any) => {
      handlers[p] = handler;
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
  registerRoutes(fakeRouter as any, "/root");
  const handler = handlers[path];
  if (!handler) throw new Error(`No GET handler registered for ${path}`);
  return handler;
}

function fakeReq(url = "http://localhost/api/openrouter/models"): any {
  return { url, headers: {} };
}

function fakeRes(): any {
  return {
    setHeader: vi.fn(),
    end: vi.fn(),
    write: vi.fn(),
    writeHead: vi.fn(),
    headersSent: false,
  };
}

// sendJson writes the JSON via res.end(JSON.stringify(...)) — recover it.
function bodyFromRes(res: any): unknown {
  const calls = (res.end as ReturnType<typeof vi.fn>).mock.calls;
  if (!calls.length) return undefined;
  const last = calls[calls.length - 1][0];
  if (typeof last !== "string") return last;
  try {
    return JSON.parse(last);
  } catch {
    return last;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("0710: /api/openrouter/models canonicalizes pricing to per-1M-tokens", () => {
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  // registerRoutes wires dozens of routes — capture the OpenRouter handler
  // ONCE per file rather than re-registering for every test. The handler
  // closes over the live OPENROUTER_CACHE which beforeEach clears.
  let handler: (req: any, res: any) => Promise<void>;

  beforeEach(() => {
    resetOpenRouterCache();
    process.env.OPENROUTER_API_KEY = "sk-or-test-token-abcd1234";
    if (!handler) handler = captureGetHandler("/api/openrouter/models");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    globalThis.fetch = originalFetch;
    resetOpenRouterCache();
    vi.restoreAllMocks();
  });

  function mockOpenRouterResponse(data: unknown): void {
    globalThis.fetch = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => data,
      }) as any,
    ) as any;
  }

  it("TC-001: converts upstream per-token pricing to per-1M-tokens (Sonnet-class rate)", async () => {
    mockOpenRouterResponse({
      data: [
        {
          id: "anthropic/claude-sonnet-4",
          name: "Sonnet 4",
          context_length: 200_000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
      ],
    });

    const res = fakeRes();
    await handler(fakeReq(), res);

    const body = bodyFromRes(res) as { models?: any[] };
    expect(body.models).toBeDefined();
    expect(body.models).toHaveLength(1);
    // Per-1M-tokens canonical wire unit: parity with PROVIDER_MODELS["anthropic"] entries (3, 15).
    expect(body.models![0].pricing).toEqual({ prompt: 3, completion: 15 });
  });

  it("TC-002: free models (upstream prompt: '0') stay at zero — no NaN, no infinity", async () => {
    mockOpenRouterResponse({
      data: [
        {
          id: "free/free-model",
          name: "Free Model",
          context_length: 8192,
          pricing: { prompt: "0", completion: "0" },
        },
      ],
    });

    const res = fakeRes();
    await handler(fakeReq(), res);

    const body = bodyFromRes(res) as { models?: any[] };
    expect(body.models![0].pricing).toEqual({ prompt: 0, completion: 0 });
    expect(Number.isFinite(body.models![0].pricing.prompt)).toBe(true);
    expect(Number.isFinite(body.models![0].pricing.completion)).toBe(true);
  });

  it("TC-003: missing pricing field defaults to {prompt: 0, completion: 0}", async () => {
    mockOpenRouterResponse({
      data: [
        {
          id: "weird/no-pricing",
          name: "No Pricing",
          context_length: 4096,
          // pricing field intentionally omitted
        },
      ],
    });

    const res = fakeRes();
    await handler(fakeReq(), res);

    const body = bodyFromRes(res) as { models?: any[] };
    expect(body.models![0].pricing).toEqual({ prompt: 0, completion: 0 });
  });

  it("TC-004: cached entry stores per-1M values (cache is self-describing)", async () => {
    mockOpenRouterResponse({
      data: [
        {
          id: "anthropic/claude-opus-4",
          name: "Opus 4",
          context_length: 200_000,
          pricing: { prompt: "0.000015", completion: "0.000075" },
        },
      ],
    });

    const res = fakeRes();
    await handler(fakeReq(), res);

    const cacheKey = "abcd1234"; // last-8 of OPENROUTER_API_KEY
    const cached = OPENROUTER_CACHE.get(cacheKey);
    expect(cached).toBeDefined();
    expect(cached!.value).toHaveLength(1);
    expect(cached!.value[0].pricing).toEqual({ prompt: 15, completion: 75 });
  });
});
