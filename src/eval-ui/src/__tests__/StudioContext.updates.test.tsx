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

// Replace api.getSkills + api.getSkillUpdates so we can drive the merge.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(),
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
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
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
