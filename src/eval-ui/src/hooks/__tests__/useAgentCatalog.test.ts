// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0682 F-005 — useAgentCatalog unit tests.
//
// Covers:
//   - /api/config merge → AgentCatalog with proper ordering, billingMode
//     metadata, displayName mapping, and ctaType per agent.
//   - /api/openrouter/models hydration on focusAgent('openrouter') with
//     5-minute SWR window (no re-fetch within window).
//   - Stale catalog callback when /api/openrouter/models returns stale=true.
//   - setActive() POSTs to /api/config and updates the local catalog.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgentCatalog, type AgentCatalog } from "../useAgentCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface HookHandle {
  catalog: AgentCatalog | null;
  status: ReturnType<typeof useAgentCatalog>["status"];
  focusAgent: ReturnType<typeof useAgentCatalog>["focusAgent"];
  setActive: ReturnType<typeof useAgentCatalog>["setActive"];
  refresh: ReturnType<typeof useAgentCatalog>["refresh"];
}

async function renderHook(
  opts?: Parameters<typeof useAgentCatalog>[0],
  onHandle?: (h: HookHandle) => void,
): Promise<{ getHandle: () => HookHandle; rerender: () => void }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const handleRef: { current: HookHandle | null } = { current: null };
  const Harness: React.FC = () => {
    const r = useAgentCatalog(opts);
    handleRef.current = r;
    if (onHandle) onHandle(r);
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  // Allow the loadBase effect to flush its fetch promise.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    getHandle: () => handleRef.current!,
    rerender: () => act(() => { root.render(React.createElement(Harness)); }),
  };
}

const baseConfig = () => ({
  provider: "claude-cli",
  model: "sonnet",
  providers: [
    { id: "claude-cli", label: "Claude Code", available: true,
      models: [{ id: "sonnet", label: "Claude Sonnet" }],
      resolvedModel: "claude-sonnet-4-6" },
    { id: "anthropic", label: "Anthropic API", available: false, models: [] },
    { id: "openrouter", label: "OpenRouter", available: true, models: [] },
    { id: "ollama", label: "Ollama (local, free)", available: false, models: [] },
  ],
  detection: {
    wrapperFolders: { ".claude": true, ".cursor": false },
    binaries: { claude: true, cursor: false },
  },
});

describe("useAgentCatalog — base config merge", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads /api/config and yields an AgentCatalog with documented ordering", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    expect(h.status).toBe("ready");
    expect(h.catalog).not.toBeNull();
    const ids = h.catalog!.agents.map((a) => a.id);
    // Documented ordering: claude-cli first; ollama appears after the cloud
    // agents (below-divider). Anthropic is grouped above the divider.
    expect(ids[0]).toBe("claude-cli");
    expect(ids).toContain("openrouter");
    expect(ids[ids.length - 1]).toBe("ollama");
  });

  it("populates billingMode per agent (subscription / per-token / free)", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const claude = h.catalog!.agents.find((a) => a.id === "claude-cli")!;
    const anthropic = h.catalog!.agents.find((a) => a.id === "anthropic")!;
    const ollama = h.catalog!.agents.find((a) => a.id === "ollama")!;
    expect(claude.models[0]?.billingMode).toBe("subscription"); // voice-allow — internal billing-mode enum
    // anthropic + ollama have no models in baseConfig, so check the agent
    // entry's metadata via ctaType / displayName instead.
    expect(anthropic.ctaType).toBe("api-key");
    expect(ollama.ctaType).toBe("start-service");
  });

  it("maps server label to canonical displayName", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const claude = h.catalog!.agents.find((a) => a.id === "claude-cli")!;
    expect(claude.displayName).toBe("Claude Code");
    const ollama = h.catalog!.agents.find((a) => a.id === "ollama")!;
    expect(ollama.displayName).toBe("Ollama");
  });

  it("propagates resolvedModel on the claude-cli agent (0701)", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const claude = h.catalog!.agents.find((a) => a.id === "claude-cli")!;
    expect(claude.resolvedModel).toBe("claude-sonnet-4-6");
  });

  it("derives wrapperFolderPresent + binaryAvailable from detection block", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const claude = h.catalog!.agents.find((a) => a.id === "claude-cli")!;
    expect(claude.wrapperFolderPresent).toBe(true);
    expect(claude.binaryAvailable).toBe(true);
  });
});

describe("useAgentCatalog — OpenRouter hydration with SWR", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(
          JSON.stringify({
            models: [
              { id: "openai/gpt-4o", name: "GPT-4o", contextWindow: 128_000, pricing: { prompt: 5, completion: 15 } },
            ],
            ageSec: 0,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls /api/openrouter/models on focusAgent('openrouter')", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const React = await import("react");
    const { act } = await import("react");
    void React; // type-only retain for ESM
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.endsWith("/api/openrouter/models"))).toBe(true);
  });

  it("does NOT re-fetch within the 5-minute SWR window", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
    });
    const orFetches = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.endsWith("/api/openrouter/models"));
    expect(orFetches.length).toBe(1);
  });

  it("does NOT fetch /api/openrouter/models for non-openrouter agents", async () => {
    const { getHandle } = await renderHook();
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("anthropic");
      await Promise.resolve();
    });
    const orFetches = fetchSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((c) => c.endsWith("/api/openrouter/models"));
    expect(orFetches.length).toBe(0);
  });

  it("invokes onStaleCatalog when the response is marked stale", async () => {
    fetchSpy.mockImplementation(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(JSON.stringify({ models: [], ageSec: 700, stale: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    const onStale = vi.fn();
    const { getHandle } = await renderHook({ onStaleCatalog: onStale });
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onStale).toHaveBeenCalledWith("openrouter", 700_000);
  });
});

describe("useAgentCatalog — CR-003: age-based stale-catalog toast", () => {
  it("invokes onStaleCatalog when ageSec > 600 even without server stale flag", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        // ageSec=900s (>600), stale flag NOT set — pre-CR-003 this would
        // have silently skipped onStaleCatalog. Now we should still toast.
        return new Response(JSON.stringify({ models: [], ageSec: 900 }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const onStale = vi.fn();
    const { getHandle } = await renderHook({ onStaleCatalog: onStale });
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onStale).toHaveBeenCalledWith("openrouter", 900_000);
  });
});

describe("useAgentCatalog — F-002 (review iter 3): setActive surfaces network errors", () => {
  it("calls onSetActiveError when fetch throws (e.g. offline)", async () => {
    let baseLoaded = false;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config") && (!init || init.method !== "POST")) {
        baseLoaded = true;
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      // Simulate a network drop on the POST.
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    const onSetActiveError = vi.fn();
    const { getHandle } = await renderHook({ onSetActiveError });
    const h = getHandle();
    expect(baseLoaded).toBe(true);
    const { act } = await import("react");
    await act(async () => {
      await h.setActive("anthropic", "haiku");
    });
    expect(onSetActiveError).toHaveBeenCalled();
    const message = onSetActiveError.mock.calls[0]![0] as string;
    expect(message).toMatch(/Network error/i);
    // Catalog NOT updated to the rejected selection.
    expect(getHandle().catalog?.activeAgent).toBe("claude-cli");
  });
});

describe("useAgentCatalog — CR-002: setActive surfaces non-OK responses", () => {
  it("calls onSetActiveError when POST /api/config returns 4xx", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config") && (!init || init.method !== "POST")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/config") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY missing" }), { status: 400 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const onSetActiveError = vi.fn();
    const { getHandle } = await renderHook({ onSetActiveError });
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      await h.setActive("anthropic", "haiku");
    });
    expect(onSetActiveError).toHaveBeenCalledWith("ANTHROPIC_API_KEY missing");
    // Catalog should NOT have updated to the rejected selection.
    const updated = getHandle();
    expect(updated.catalog?.activeAgent).toBe("claude-cli");
  });
});

describe("useAgentCatalog — CR-0682-M3: openRouterError surfaces non-key fetch failures", () => {
  it("sets openRouterError on a 500 from /api/openrouter/models", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response("upstream broken", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getHandle } = await renderHook();
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getHandle().openRouterError).toMatch(/500/);
  });

  it("does NOT set openRouterError on a 400 (no key) — agent CTA covers it", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), { status: 400 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getHandle } = await renderHook();
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      h.focusAgent("openrouter");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getHandle().openRouterError).toBeNull();
  });
});

describe("useAgentCatalog — setActive POSTs config + updates catalog", () => {
  it("POSTs /api/config and reflects the new active agent/model on success", async () => {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config") && (!init || init.method !== "POST")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/config") && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const { getHandle } = await renderHook();
    const h = getHandle();
    const { act } = await import("react");
    await act(async () => {
      await h.setActive("anthropic", "haiku");
    });
    const updated = getHandle();
    expect(updated.catalog?.activeAgent).toBe("anthropic");
    expect(updated.catalog?.activeModel).toBe("haiku");
    const postCall = fetchSpy.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
  });
});
