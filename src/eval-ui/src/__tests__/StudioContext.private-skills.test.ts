// @vitest-environment jsdom
// Skills installed from a private repo (`sourcePrivate`, set by /api/skills)
// never reach verified-skill.com from the Studio: not in the check-updates ID
// resolution POST, not in the reconcile tracking list.
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

type SkillInfo = import("../types").SkillInfo;

const trackingIdsSeen: string[][] = [];

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(async () => []),
      lookupSkillsByName: vi.fn(async () => []),
    },
  };
});

vi.mock("../hooks/useSkillUpdates", () => ({
  useSkillUpdates: (opts: { trackingSkillIds?: string[] }) => {
    trackingIdsSeen.push([...(opts.trackingSkillIds ?? [])]);
    return {
      updates: [],
      updatesMap: new Map(),
      updateCount: 0,
      refresh: vi.fn(),
      lastFetchAt: null,
      error: null,
      status: "idle" as const,
      updatesById: new Map(),
      reconcileCheckUpdates: vi.fn(),
    };
  },
}));

function makeSkill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: ".claude",
    skill: "s",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    currentVersion: "1.0.0",
    ...overrides,
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; body: string }> = [];

beforeEach(() => {
  trackingIdsSeen.length = 0;
  fetchCalls = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), body: typeof init?.body === "string" ? init.body : "" });
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("StudioContext — private skills stay local", () => {
  it("normalizeSkillInfo keeps the server's sourcePrivate flag", async () => {
    const { normalizeSkillInfo } = await import("../api");
    expect(normalizeSkillInfo({ plugin: "p", skill: "a", origin: "installed", sourcePrivate: true }).sourcePrivate).toBe(true);
    expect(normalizeSkillInfo({ plugin: "p", skill: "b", origin: "installed" }).sourcePrivate).toBeUndefined();
  });

  it("never posts a private skill to check-updates or tracks it for reconcile", async () => {
    const { api } = await import("../api");
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSkill({ skill: "resume-tuner", sourcePrivate: true }),
      makeSkill({ skill: "open-skill" }),
    ]);

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioProvider } = await import("../StudioContext");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(StudioProvider, null, null));
      });
      await act(async () => {
        await flushMicrotasks();
      });

      const checkUpdates = fetchCalls.filter((c) => c.url.includes("/api/v1/skills/check-updates"));
      expect(checkUpdates.length).toBeGreaterThanOrEqual(1);
      for (const c of fetchCalls) {
        expect(c.url).not.toContain("resume-tuner");
        expect(c.body).not.toContain("resume-tuner");
      }
      expect(checkUpdates.some((c) => c.body.includes("open-skill"))).toBe(true);

      const lastTracking = trackingIdsSeen[trackingIdsSeen.length - 1];
      expect(lastTracking).toContain(".claude/open-skill");
      expect(lastTracking).not.toContain(".claude/resume-tuner");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
  it("never sends a skill authored in a private repo to lookup-by-name", async () => {
    const { api } = await import("../api");
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeSkill({ skill: "my-private-draft", origin: "source", author: "acme", sourcePrivate: true }),
      makeSkill({ skill: "my-public-skill", origin: "source", author: "acme" }),
    ]);
    const lookup = api.lookupSkillsByName as ReturnType<typeof vi.fn>;
    lookup.mockClear();

    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { StudioProvider } = await import("../StudioContext");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(StudioProvider, null, null));
      });
      await act(async () => {
        await flushMicrotasks();
      });

      const sent = lookup.mock.calls.flatMap((c) => c[0] as Array<{ name: string }>).map((e) => e.name);
      expect(sent).toContain("my-public-skill");
      expect(sent).not.toContain("my-private-draft");
      for (const c of fetchCalls) {
        expect(c.url).not.toContain("my-private-draft");
        expect(c.body).not.toContain("my-private-draft");
      }
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
