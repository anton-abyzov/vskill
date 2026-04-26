// @vitest-environment jsdom
// 0733: StudioContext MUST issue its first /api/skills request with an
// `agent=<id>` filter — never with a null/undefined agent — so the picker's
// visible selection and the fetched skill list cannot diverge.
//
// Mounts <StudioProvider> with localStorage either empty (cold path: must
// bootstrap from /api/agents) or pre-populated (warm path: reuse persisted
// agent, no /api/agents fetch).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

type ContextValue = import("../StudioContext").StudioContextValue;

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(),
      getAgents: vi.fn(),
    },
  };
});

async function renderProvider(probeRef: { current: ContextValue | null }) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { StudioProvider, useStudio } = await import("../StudioContext");

  function Probe() {
    probeRef.current = useStudio();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(StudioProvider, null, React.createElement(Probe)),
    );
  });
  return {
    container,
    act: (fn: () => void | Promise<void>) => act(async () => { await fn(); }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("StudioContext — first-load filter (0733)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("AC-US1-01 / AC-US3-01 / AC-US3-02: cold start — fetches /api/agents, then /api/skills with agent=<suggested>", async () => {
    const { api } = await import("../api");
    (api.getAgents as ReturnType<typeof vi.fn>).mockResolvedValue({
      agents: [],
      suggested: "claude-code",
      hasInstalledAgents: true,
    });
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flush(); });

      // Bootstrap path: getAgents was called.
      expect(api.getAgents).toHaveBeenCalled();

      // First /api/skills call MUST carry agent=claude-code.
      // Critically: must NOT have been called with undefined or {}.
      expect(api.getSkills).toHaveBeenCalled();
      const calls = (api.getSkills as ReturnType<typeof vi.fn>).mock.calls;
      // Every call must include a non-empty agent filter.
      for (const call of calls) {
        const filter = call[0] as { agent?: string } | undefined;
        expect(filter, `getSkills called without filter: ${JSON.stringify(call)}`).toBeDefined();
        expect(filter?.agent, `getSkills called without agent: ${JSON.stringify(call)}`).toBe("claude-code");
      }
    } finally {
      h.unmount();
    }
  });

  it("AC-US1-04 / AC-US3-03: warm start — localStorage agent wins, /api/agents NOT called", async () => {
    window.localStorage.setItem(
      "vskill.studio.prefs",
      JSON.stringify({ activeAgent: "cursor" }),
    );

    const { api } = await import("../api");
    (api.getAgents as ReturnType<typeof vi.fn>).mockResolvedValue({
      agents: [],
      suggested: "claude-code",
      hasInstalledAgents: true,
    });
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flush(); });

      // Warm path: must NOT call /api/agents — localStorage already has a value.
      expect(api.getAgents).not.toHaveBeenCalled();

      // First /api/skills call uses the persisted agent, not the suggested one.
      expect(api.getSkills).toHaveBeenCalled();
      const calls = (api.getSkills as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        const filter = call[0] as { agent?: string } | undefined;
        expect(filter?.agent).toBe("cursor");
      }
    } finally {
      h.unmount();
    }
  });
});
