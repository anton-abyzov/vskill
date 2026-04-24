// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0702 T-042: SSE 401 → studio:api-key-error dispatch — RED.
//
// When the eval server responds to a POST-style SSE start with:
//
//   HTTP 401
//   body: { error: "invalid_api_key", provider: "anthropic" }
//
// the shared SSE helper must dispatch a `studio:api-key-error` CustomEvent
// carrying `{ provider }` so the app-level toast hook can surface the UI.
// The existing error-message branch still fires (errors remain observable);
// the dispatch is an additive signal.
// ---------------------------------------------------------------------------

type ReactLib = typeof import("react");
type Root = ReturnType<typeof import("react-dom/client")["createRoot"]>;

interface UseSSEHandle {
  start: (url: string, body?: unknown) => Promise<void>;
  error: string | null;
  running: boolean;
}

async function mountUseSSE(): Promise<{
  ref: { current: UseSSEHandle | null };
  runStart: (url: string, body?: unknown) => Promise<void>;
  unmount: () => void;
}> {
  const React: ReactLib = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { useSSE } = await import("../sse");

  const ref: { current: UseSSEHandle | null } = { current: null };
  function Probe() {
    const h = useSSE();
    ref.current = { start: h.start, error: h.error, running: h.running };
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(Probe));
  });
  return {
    ref,
    async runStart(url, body) {
      await act(async () => {
        await ref.current!.start(url, body);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function make401Response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

describe("0702 T-042: SSE 401 dispatches studio:api-key-error", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches CustomEvent with provider when body matches invalid_api_key shape", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      make401Response({ error: "invalid_api_key", provider: "anthropic" }),
    ) as unknown as typeof fetch;

    const seen: Array<{ provider: string }> = [];
    function onErr(e: Event) {
      const detail = (e as CustomEvent).detail as { provider?: string } | undefined;
      if (detail?.provider) seen.push({ provider: detail.provider });
    }
    window.addEventListener("studio:api-key-error", onErr);

    const h = await mountUseSSE();
    try {
      await h.runStart("/api/skills/foo/bar/benchmark", { eval_ids: [1] });
      expect(seen).toEqual([{ provider: "anthropic" }]);
    } finally {
      window.removeEventListener("studio:api-key-error", onErr);
      h.unmount();
    }
  });

  it("does NOT dispatch for non-401 failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const seen: unknown[] = [];
    function onErr(e: Event) {
      seen.push((e as CustomEvent).detail);
    }
    window.addEventListener("studio:api-key-error", onErr);

    const h = await mountUseSSE();
    try {
      await h.runStart("/api/foo");
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("studio:api-key-error", onErr);
      h.unmount();
    }
  });

  it("does NOT dispatch for 401 without the invalid_api_key shape (fallback unchanged)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "some other unauthorized reason" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const seen: unknown[] = [];
    function onErr(e: Event) {
      seen.push((e as CustomEvent).detail);
    }
    window.addEventListener("studio:api-key-error", onErr);

    const h = await mountUseSSE();
    try {
      await h.runStart("/api/foo");
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("studio:api-key-error", onErr);
      h.unmount();
    }
  });
});
