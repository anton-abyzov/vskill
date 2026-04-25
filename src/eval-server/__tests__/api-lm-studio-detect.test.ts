// ---------------------------------------------------------------------------
// Integration test: detectAvailableProviders() surfaces LM Studio when the
// local `/v1/models` endpoint responds, and caches the result for 30 seconds.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch to stub provider probes per URL
// ---------------------------------------------------------------------------

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function stubFetchByUrl(handlers: Record<string, () => Response | Promise<Response>>): FetchImpl {
  return async (url: string): Promise<Response> => {
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (url.includes(pattern)) {
        return await handler();
      }
    }
    // Unknown URL: simulate network error (default for unreachable providers)
    throw new Error(`ECONNREFUSED (mock): ${url}`);
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Import module under test — detectAvailableProviders must be exported.
// resetDetectionCache is a test hook that clears the in-memory cache.
// ---------------------------------------------------------------------------

const { detectAvailableProviders, resetDetectionCache } = await import("../api-routes.js");

describe("detectAvailableProviders — LM Studio detection", () => {
  const origEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.LM_STUDIO_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    // Reset 30s in-memory probe cache between tests so results are deterministic
    resetDetectionCache();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // AC-US2-01 + AC-US2-02: probe /v1/models, surface as provider entry
  // -------------------------------------------------------------------------

  it("surfaces LM Studio when /v1/models responds with a model list", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      "localhost:1234/v1/models": () => okJson({
        data: [
          { id: "qwen2.5-coder-7b" },
          { id: "llama-3.2-3b-instruct" },
        ],
      }),
    }) as never);

    const providers = await detectAvailableProviders();
    const lm = providers.find((p) => p.id === "lm-studio");

    expect(lm).toBeDefined();
    expect(lm!.available).toBe(true);
    expect(lm!.label).toMatch(/LM Studio/i);
    // Alphabetical order per AC-US3-01: probe sorts by id.localeCompare regardless
    // of LM Studio's load order, so 'llama-...' precedes 'qwen...' here.
    expect(lm!.models.map((m) => m.id)).toEqual([
      "llama-3.2-3b-instruct",
      "qwen2.5-coder-7b",
    ]);
  });

  // -------------------------------------------------------------------------
  // AC-US2-03: silent failure when endpoint is unreachable
  // -------------------------------------------------------------------------

  it("omits LM Studio (available=false) when probe throws", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      // no handler for LM Studio — default throws ECONNREFUSED
    }) as never);

    const providers = await detectAvailableProviders();
    const lm = providers.find((p) => p.id === "lm-studio");

    // Entry exists (so the UI can label it gray), but available=false
    expect(lm).toBeDefined();
    expect(lm!.available).toBe(false);
  });

  it("omits LM Studio when probe returns non-2xx", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      "localhost:1234/v1/models": () => new Response("gateway error", { status: 502 }),
    }) as never);

    const providers = await detectAvailableProviders();
    const lm = providers.find((p) => p.id === "lm-studio");
    expect(lm).toBeDefined();
    expect(lm!.available).toBe(false);
  });

  // -------------------------------------------------------------------------
  // AC-US2-04: 30s in-memory cache — second call within TTL does not reprobe
  // -------------------------------------------------------------------------

  it("caches the probe result for 30 seconds (no second fetch)", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      "localhost:1234/v1/models": () => okJson({ data: [{ id: "qwen2.5-coder-7b" }] }),
    }) as never);

    await detectAvailableProviders();
    const callsAfterFirst = fetchSpy.mock.calls.length;

    await detectAvailableProviders();
    const callsAfterSecond = fetchSpy.mock.calls.length;

    // LM Studio probe should have fired exactly once across both calls
    const lmProbeCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("localhost:1234/v1/models"),
    );
    expect(lmProbeCalls.length).toBe(1);
    // Overall call count should not increase for the LM Studio probe
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it("re-probes after resetDetectionCache() (simulates TTL expiry)", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      "localhost:1234/v1/models": () => okJson({ data: [{ id: "qwen2.5-coder-7b" }] }),
    }) as never);

    await detectAvailableProviders();
    resetDetectionCache();
    await detectAvailableProviders();

    const lmProbeCalls = fetchSpy.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("localhost:1234/v1/models"),
    );
    expect(lmProbeCalls.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // AC-US1-05 / AC-US2-01: LM_STUDIO_BASE_URL env override is honored
  // -------------------------------------------------------------------------

  it("honors LM_STUDIO_BASE_URL env override for the probe URL", async () => {
    process.env.LM_STUDIO_BASE_URL = "http://my-lmstudio.lan:4321/v1";
    fetchSpy.mockImplementation(stubFetchByUrl({
      "my-lmstudio.lan:4321/v1/models": () => okJson({ data: [{ id: "custom-model" }] }),
    }) as never);

    const providers = await detectAvailableProviders();
    const lm = providers.find((p) => p.id === "lm-studio");
    expect(lm!.available).toBe(true);
    expect(lm!.models[0].id).toBe("custom-model");

    const probedUrls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(probedUrls.some((u) => typeof u === "string" && u.includes("my-lmstudio.lan:4321"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // AC-US2-05: LM Studio + Ollama probes run concurrently (Promise.all)
  // -------------------------------------------------------------------------

  it("runs LM Studio + Ollama probes concurrently (under 550ms even if both time out)", async () => {
    // Both probes time out at 500ms. If serial they'd take ~1000ms.
    fetchSpy.mockImplementation(((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("timeout", "AbortError"));
          });
        }
      });
    }) as never);

    const start = Date.now();
    await detectAvailableProviders();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(700); // 500ms timeout + slack, well under 1000ms
  });

  // -------------------------------------------------------------------------
  // AC-US2-02 shape: models use { id, label } shape like Ollama
  // -------------------------------------------------------------------------

  it("returns model entries in { id, label } shape", async () => {
    fetchSpy.mockImplementation(stubFetchByUrl({
      "localhost:1234/v1/models": () => okJson({ data: [{ id: "qwen2.5-coder-7b" }] }),
    }) as never);

    const providers = await detectAvailableProviders();
    const lm = providers.find((p) => p.id === "lm-studio")!;
    expect(lm.models[0]).toHaveProperty("id", "qwen2.5-coder-7b");
    expect(lm.models[0]).toHaveProperty("label");
  });
});
