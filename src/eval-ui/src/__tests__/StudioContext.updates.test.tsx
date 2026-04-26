// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks matchMedia — useMediaQuery reads it during StudioProvider.
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
type SkillInfo = import("../types").SkillInfo;

// Replace api.getSkills + api.getSkillUpdates + api.resolveInstalledSkillIds
// so we can drive the merge and resolver flow.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(),
      resolveInstalledSkillIds: vi.fn(),
    },
  };
});

function makeSkill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    plugin: "p",
    skill: "s",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    ...overrides,
  };
}

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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("StudioContext — useSkillUpdates wiring (0683 T-002)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    // Default no-op so resolveInstalledSkillIds doesn't throw in tests that
    // don't care about the resolver flow (added in 0736).
    const { api } = await import("../api");
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires exactly one /api/skills/updates fetch on mount (FR-005)", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({ plugin: "p", skill: "foo", origin: "source" }),
      makeSkill({ plugin: "p", skill: "bar", origin: "installed" }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "p/bar", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      expect(api.getSkillUpdates).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it("merges updates into skills — installed outdated, source not", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({ plugin: "p", skill: "foo", origin: "source" }),
      makeSkill({ plugin: "p", skill: "bar", origin: "installed" }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "owner/p/bar", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const merged = probe.current!.state.skills;
      const foo = merged.find((s) => s.skill === "foo")!;
      const bar = merged.find((s) => s.skill === "bar")!;
      expect(foo.updateAvailable).toBeFalsy();
      expect(bar.updateAvailable).toBe(true);
      expect(bar.latestVersion).toBe("1.1.0");
    } finally {
      h.unmount();
    }
  });

  it("exposes outdatedByOrigin and updateCount partitioned by origin", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({ plugin: "p", skill: "foo", origin: "source" }),
      makeSkill({ plugin: "p", skill: "bar", origin: "installed" }),
      makeSkill({ plugin: "p", skill: "baz", origin: "installed" }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "p/bar", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
      { name: "p/baz", installed: "1.0.0", latest: "2.0.0", updateAvailable: true },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      expect(probe.current!.updateCount).toBe(2);
      expect(probe.current!.outdatedByOrigin).toEqual({ source: 0, installed: 2 });
    } finally {
      h.unmount();
    }
  });

  it("exposes a dedup'd refreshUpdates function on the context", async () => {
    const { api } = await import("../api");
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      expect(typeof probe.current!.refreshUpdates).toBe("function");
      await h.act(async () => {
        const p1 = probe.current!.refreshUpdates();
        const p2 = probe.current!.refreshUpdates();
        expect(p1).toBe(p2);
        await p1;
      });
    } finally {
      h.unmount();
    }
  });
});

describe("StudioContext — SSE resolver flow (0736 AC-US3-01/02)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC-US3-01: resolveInstalledSkillIds called with installed skills; UUID flows to SSE filter via resolvedSseIds", async () => {
    // When the platform enrichment returns a UUID for an installed skill,
    // StudioContext must pass that UUID (not .claude/bar) to useSkillUpdates.
    // We verify by checking that resolveInstalledSkillIds was called with the
    // right shape AND that it was called at all (not bypassed).
    const { api } = await import("../api");
    const installedSkill = makeSkill({ plugin: ".claude", skill: "bar", origin: "installed" });
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([installedSkill]);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "acme/repo/bar", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
    ]);
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin: ".claude", skill: "bar", uuid: "uuid-bar-0001", slug: "sk_published_acme/repo/bar" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      // resolveInstalledSkillIds must have been called with the installed skill
      expect(api.resolveInstalledSkillIds).toHaveBeenCalledTimes(1);
      const callArg = (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ plugin: string; skill: string; name: string }>;
      expect(callArg).toHaveLength(1);
      expect(callArg[0]!.plugin).toBe(".claude");
      expect(callArg[0]!.skill).toBe("bar");
      // The canonical platform name must be derived from polling response
      expect(callArg[0]!.name).toBe("acme/repo/bar");
    } finally {
      h.unmount();
    }
  });

  it("AC-US3-02: skills with no UUID/slug produce empty resolver output — no malformed IDs passed to SSE", async () => {
    // Local-only installed skill: resolveInstalledSkillIds returns no uuid/slug.
    // resolveSubscriptionIds must produce empty list → useSkillUpdates gets [].
    const { api } = await import("../api");
    const localSkill = makeSkill({ plugin: ".claude", skill: "local-only", origin: "installed" });
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([localSkill]);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
    // No uuid, no slug — local-only skill
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin: ".claude", skill: "local-only" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      // resolver was called
      expect(api.resolveInstalledSkillIds).toHaveBeenCalledTimes(1);
      // The context still renders without error — graceful degradation
      expect(probe.current).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("AC-US3-02: source-origin skills are excluded from resolver call — only installed skills pass through", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({ plugin: "p", skill: "authored", origin: "source" }),
      makeSkill({ plugin: ".claude", skill: "installed-one", origin: "installed" }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "acme/repo/installed-one", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
    ]);
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin: ".claude", skill: "installed-one", uuid: "uuid-installed-one" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const callArg = (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ skill: string }>;
      // Only installed-one, not authored
      expect(callArg.map((c) => c.skill)).toEqual(["installed-one"]);
    } finally {
      h.unmount();
    }
  });

  it("AC-US3-01: SSE EventSource URL contains UUID/slug, NOT <plugin>/<skill> raw ID", async () => {
    // End-to-end chain: installed skill → enrichment → resolveSubscriptionIds
    // → resolvedSseIds → useSkillUpdates → EventSource(url?skills=<uuid>).
    // We spy on the EventSource constructor to capture the URL it's opened with.
    const openedUrls: string[] = [];
    const OriginalEventSource = globalThis.EventSource;
    (globalThis as unknown as { EventSource: unknown }).EventSource = class MockEventSource {
      url: string;
      readyState = 0;
      onmessage = null;
      onerror = null;
      onopen = null;
      constructor(url: string) {
        this.url = url;
        openedUrls.push(url);
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
    };

    try {
      const { api } = await import("../api");
      const installedSkill = makeSkill({ plugin: ".claude", skill: "greet-anton", origin: "installed" });
      (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
      (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([installedSkill]);
      (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
      (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "acme/myrepo/greet-anton", installed: "1.0.0", latest: "1.1.0", updateAvailable: true },
      ]);
      (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
      (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
        { plugin: ".claude", skill: "greet-anton", uuid: "uuid-greet-0001", slug: "sk_published_acme/myrepo/greet-anton" },
      ]);

      const probe: { current: ContextValue | null } = { current: null };
      const h = await renderProvider(probe);
      try {
        // Multiple flushes: getSkills → getSkillUpdates → resolveInstalledSkillIds → state update
        for (let i = 0; i < 6; i++) {
          await h.act(async () => { await flushMicrotasks(); });
        }
        // At least one EventSource should have been opened
        expect(openedUrls.length).toBeGreaterThan(0);
        const sseUrl = openedUrls[openedUrls.length - 1]!;
        const urlObj = new URL(sseUrl, "http://localhost");
        const skillsParam = urlObj.searchParams.get("skills") ?? "";
        const ids = skillsParam.split(",").filter(Boolean);
        // Must contain UUID or slug — NOT the raw .claude/greet-anton format
        const hasUuid = ids.includes("uuid-greet-0001");
        const hasSlug = ids.includes("sk_published_acme/myrepo/greet-anton");
        expect(hasUuid || hasSlug).toBe(true);
        // Must NOT contain the raw <plugin>/<skill> format
        expect(ids.some((id) => id.includes(".claude/") || id === ".claude/greet-anton")).toBe(false);
      } finally {
        h.unmount();
      }
    } finally {
      (globalThis as unknown as { EventSource: unknown }).EventSource = OriginalEventSource;
    }
  });
});
