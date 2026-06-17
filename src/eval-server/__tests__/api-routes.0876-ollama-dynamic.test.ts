// ---------------------------------------------------------------------------
// 0876 US-001: the Ollama provider entry must reflect the REAL list of locally
// installed models (probed via GET /api/tags), never a hardcoded fallback.
// Before this fix, a timed-out / failed probe leaked four fake models
// (llama3.1:8b, qwen2.5:32b, gemma2:9b, mistral:7b) into the Studio picker.
//
// Mirrors api-lm-studio-detect.test.ts: drive through the public
// detectAvailableProviders() and reset the 30s probe cache in beforeEach.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { detectAvailableProviders, resetDetectionCache } = await import("../api-routes.js");

const OLLAMA_TAGS = "localhost:11434/api/tags";

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("detectAvailableProviders — Ollama dynamic model list (0876)", () => {
  const origEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.LM_STUDIO_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    fetchSpy = vi.spyOn(globalThis, "fetch");
    resetDetectionCache();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // (a) AC-US1-02: unreachable Ollama → available=false, models=[], NO fake names
  // -------------------------------------------------------------------------
  it("returns available=false, models=[] when the probe rejects (offline) — no fake llama/gemma/mistral leak", async () => {
    fetchSpy.mockImplementation((() =>
      Promise.reject(new DOMException("timeout", "AbortError"))) as never);

    const providers = await detectAvailableProviders();
    const ollama = providers.find((p) => p.id === "ollama");

    expect(ollama).toBeDefined();
    expect(ollama!.available).toBe(false);
    expect(ollama!.models).toEqual([]);
    // Regression guard: the hardcoded fallback list must never leak through.
    expect(ollama!.models.some((m) => /llama|gemma|mistral/i.test(m.id))).toBe(false);
  });

  // -------------------------------------------------------------------------
  // (b) AC-US1-03: /api/tags 200 → dynamic list, blank names filtered out
  // -------------------------------------------------------------------------
  it("returns the live model list from /api/tags (blank names filtered)", async () => {
    fetchSpy.mockImplementation(((url: string) => {
      if (typeof url === "string" && url.includes(OLLAMA_TAGS)) {
        return Promise.resolve(okJson({
          models: [
            { name: "qwen3-coder:30b" },
            { name: "qwen2.5:14b" },
            { name: "" },
          ],
        }));
      }
      return Promise.reject(new Error(`ECONNREFUSED (mock): ${url}`));
    }) as never);

    const providers = await detectAvailableProviders();
    const ollama = providers.find((p) => p.id === "ollama");

    expect(ollama!.available).toBe(true);
    expect(ollama!.models).toEqual([
      { id: "qwen3-coder:30b", label: "qwen3-coder:30b" },
      { id: "qwen2.5:14b", label: "qwen2.5:14b" },
    ]);
  });

  // -------------------------------------------------------------------------
  // (c) AC-US1-02: 200 with an unparseable body → available=false, models=[]
  // -------------------------------------------------------------------------
  it("returns available=false, models=[] when a 200 body fails to JSON-parse", async () => {
    fetchSpy.mockImplementation(((url: string) => {
      if (typeof url === "string" && url.includes(OLLAMA_TAGS)) {
        return Promise.resolve(new Response("<html>not json</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }));
      }
      return Promise.reject(new Error(`ECONNREFUSED (mock): ${url}`));
    }) as never);

    const providers = await detectAvailableProviders();
    const ollama = providers.find((p) => p.id === "ollama");

    expect(ollama!.available).toBe(false);
    expect(ollama!.models).toEqual([]);
  });
});
