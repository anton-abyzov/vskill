// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0876 US-002 — OpenRouter hover must never crash on a malformed catalog.
//
// Two failure surfaces, two layers:
//   (T-006) ModelList.rankFiltered() dereferenced `m.displayName.toLowerCase()`
//           in the filter + both sort comparators. A null/missing displayName
//           (from an OpenRouter row whose `name` was null) threw
//           "Cannot read properties of null (reading 'toLowerCase')" the moment
//           the auto-focused search box held a query.
//   (T-005) useAgentCatalog.hydrateOpenRouter() mapped `data.models` unguarded
//           (threw when the shape lacked `models`) and copied `m.name` straight
//           into displayName (yielding a null displayName downstream).
//
// rankFiltered + the mapping helper are both module-private, so these are
// exercised through their public surfaces: <ModelList> for the rank path and
// useAgentCatalog (via a render harness) for the mapping path.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  useAgentCatalog,
  type AgentCatalog,
  type AgentEntry,
  type ModelEntry,
} from "../../hooks/useAgentCatalog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// T-006 — ModelList / rankFiltered null-safety (rendered through the component
// because rankFiltered is not exported).
// ---------------------------------------------------------------------------

function openRouterAgent(models: ModelEntry[]): AgentEntry {
  return {
    id: "openrouter",
    displayName: "OpenRouter",
    available: true,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: null,
    models,
  } as AgentEntry;
}

async function renderModelList(agent: AgentEntry, activeModelId: string | null = null): Promise<HTMLElement> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ModelList } = await import("../ModelList");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ModelList, {
        agent,
        activeModelId,
        onSelect: vi.fn(),
        onOpenSettings: vi.fn(),
      }),
    );
  });
  // Flush the debounce + auto-focus effects.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

// The search box is debounced (60ms). Drive a query end-to-end and let the
// debounce timer settle so rankFiltered runs against a real query string.
async function typeQuery(container: HTMLElement, query: string): Promise<void> {
  const { act } = await import("react");
  vi.useFakeTimers();
  try {
    const input = container.querySelector<HTMLInputElement>(
      "[data-testid='model-search-input']",
    );
    expect(input).not.toBeNull();
    act(() => {
      input!.value = query;
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
  } finally {
    vi.useRealTimers();
  }
}

describe("0876 T-006 — rankFiltered never throws on null displayName", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("renders a row whose displayName is null when a matching query is typed", async () => {
    const agent = openRouterAgent([
      { id: "x/y", displayName: null as unknown as string, billingMode: "per-token" } as ModelEntry,
    ]);
    const container = await renderModelList(agent, null);

    // Typing "y" must NOT throw — pre-fix this hit
    // `m.displayName.toLowerCase()` with displayName === null.
    await expect(typeQuery(container, "y")).resolves.toBeUndefined();

    // The row still renders. rankFiltered matches it via the id fallback, and
    // ModelRow exposes the id through its `title` attribute (display text comes
    // from displayName, which the catalog mapping never leaves null in
    // production — see the T-005 hydrateOpenRouter tests below).
    const row = container.querySelector("[data-testid='model-row-x/y']");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("title")).toBe("x/y");
  });

  it("ranks a null-displayName row alongside a normal row without throwing", async () => {
    const agent = openRouterAgent([
      { id: "anthropic/claude-yy", displayName: "Claude YY", billingMode: "per-token" } as ModelEntry,
      { id: "x/yz", displayName: null as unknown as string, billingMode: "per-token" } as ModelEntry,
    ]);
    const container = await renderModelList(agent, null);

    // Query that matches both rows (one via displayName, one via id fallback).
    await expect(typeQuery(container, "y")).resolves.toBeUndefined();

    expect(container.querySelector("[data-testid='model-row-x/yz']")).not.toBeNull();
    expect(container.querySelector("[data-testid='model-row-anthropic/claude-yy']")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-005 — hydrateOpenRouter mapping null-safety (exercised through the public
// useAgentCatalog hook because the mapping is module-private).
// ---------------------------------------------------------------------------

interface HookHandle {
  catalog: AgentCatalog | null;
  status: ReturnType<typeof useAgentCatalog>["status"];
  focusAgent: ReturnType<typeof useAgentCatalog>["focusAgent"];
}

const baseConfig = () => ({
  provider: "claude-cli",
  model: "sonnet",
  providers: [
    { id: "claude-cli", label: "Claude Code", available: true, models: [{ id: "sonnet", label: "Claude Sonnet" }] },
    { id: "openrouter", label: "OpenRouter", available: true, models: [] },
  ],
  detection: { wrapperFolders: {}, binaries: {} },
});

async function renderHook(): Promise<{ getHandle: () => HookHandle }> {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const handleRef: { current: HookHandle | null } = { current: null };
  const Harness: React.FC = () => {
    handleRef.current = useAgentCatalog();
    return null;
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Harness));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { getHandle: () => handleRef.current! };
}

async function focusOpenRouter(getHandle: () => HookHandle): Promise<void> {
  const { act } = await import("react");
  await act(async () => {
    getHandle().focusAgent("openrouter");
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openRouterModels(getHandle: () => HookHandle): ModelEntry[] {
  return getHandle().catalog!.agents.find((a) => a.id === "openrouter")!.models;
}

describe("0876 T-005 — hydrateOpenRouter tolerates a malformed catalog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("treats a response with no `models` array as empty (no throw)", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(JSON.stringify({}), { status: 200 }); // no `models`
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const { getHandle } = await renderHook();
    // Pre-fix: data.models.map() threw on the missing array and was swallowed
    // by the catch, leaving an empty list — but a null/undefined here used to
    // explode. Post-fix it must resolve cleanly to an empty list.
    await expect(focusOpenRouter(getHandle)).resolves.toBeUndefined();
    expect(openRouterModels(getHandle)).toEqual([]);
  });

  it("falls back displayName to id when a model `name` is null", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(
          JSON.stringify({ models: [{ id: "a/b", name: null }] }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const { getHandle } = await renderHook();
    await focusOpenRouter(getHandle);
    const models = openRouterModels(getHandle);
    expect(models).toHaveLength(1);
    expect(models[0]!.id).toBe("a/b");
    expect(models[0]!.displayName).toBe("a/b"); // fell back to id
  });

  it("drops entries lacking both id and name so every ModelEntry has an id", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.endsWith("/api/config")) {
        return new Response(JSON.stringify(baseConfig()), { status: 200 });
      }
      if (u.endsWith("/api/openrouter/models")) {
        return new Response(
          JSON.stringify({
            models: [
              { id: "good/model", name: "Good Model" },
              { id: null, name: null }, // junk row — must be dropped
              { name: "Name Only" }, // keepable: id falls back to name
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const { getHandle } = await renderHook();
    await focusOpenRouter(getHandle);
    const models = openRouterModels(getHandle);
    // The all-null junk row is gone; every surviving entry has a non-empty id.
    expect(models.every((m) => Boolean(m.id))).toBe(true);
    expect(models.map((m) => m.id)).toContain("good/model");
    expect(models).not.toContainEqual(expect.objectContaining({ id: "" }));
  });
});

// ---------------------------------------------------------------------------
// US-002 (hook order) — the SECOND OpenRouter-hover crash, surfaced by the e2e
// run. ModelList's empty-card early return sat AFTER two useEffects but BEFORE
// useMemo + useVirtualList. The picker renders ModelList at a fixed tree
// position, so switching the displayed agent from an available provider (full
// render) to OpenRouter-without-a-key (early return) changed the hook count on
// the SAME instance → React #300 ("rendered fewer hooks than expected"), which
// unmounted the whole picker on hover. Only reproduces across a re-render of
// the same instance — the single-render tests above never hit it.
// ---------------------------------------------------------------------------

function availableAgent(id: string, models: ModelEntry[]): AgentEntry {
  return {
    id,
    displayName: id,
    available: true,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: null,
    models,
  } as AgentEntry;
}

function openRouterLocked(): AgentEntry {
  return {
    id: "openrouter",
    displayName: "OpenRouter",
    available: false,
    wrapperFolder: null,
    wrapperFolderPresent: false,
    binaryAvailable: true,
    endpointReachable: null,
    ctaType: "api-key",
    models: [],
  } as AgentEntry;
}

describe("0876 — ModelList hook order stable across agent switch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not throw React #300 switching from an available provider to locked OpenRouter (and back)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { ModelList } = await import("../ModelList");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = (agent: AgentEntry) => ({
      agent,
      activeModelId: null,
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
    });

    // 1) Full render: an available provider with models (useMemo + useVirtualList run).
    act(() => {
      root.render(
        React.createElement(
          ModelList,
          props(availableAgent("anthropic", [
            { id: "claude-x", displayName: "Claude X", billingMode: "per-token" } as ModelEntry,
          ])),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    // 2) Re-render the SAME instance with locked OpenRouter (empty-card branch).
    //    Pre-fix this changed the hook count and threw React #300.
    let threw: unknown = null;
    try {
      act(() => {
        root.render(React.createElement(ModelList, props(openRouterLocked())));
      });
      await act(async () => {
        await Promise.resolve();
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(container.querySelector("[data-testid='openrouter-empty-card']")).not.toBeNull();

    // 3) Switch back to a full list — still stable.
    act(() => {
      root.render(
        React.createElement(
          ModelList,
          props(availableAgent("anthropic", [
            { id: "claude-y", displayName: "Claude Y", billingMode: "per-token" } as ModelEntry,
          ])),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector("[data-testid='model-list']")).not.toBeNull();
  });
});
