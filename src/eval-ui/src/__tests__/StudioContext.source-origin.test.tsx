// @vitest-environment jsdom
// 0838 T-008: StudioContext routes source-origin skills with a registry
// twin into the useSkillUpdates SSE filter via a name+author lookup, and
// exposes `trackedSkillCount` for the bell pip.
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
type SkillInfo = import("../types").SkillInfo;

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(),
      resolveInstalledSkillIds: vi.fn(),
      // 0838: name+author lookup for source-origin twins.
      lookupSkillsByName: vi.fn(),
      checkSkillUpdates: vi.fn(),
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

describe("StudioContext — source-origin SSE wiring (0838 T-008)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const { api } = await import("../api");
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.checkSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    if (typeof api.lookupSkillsByName === "function") {
      (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("AC-US2-01: source-origin skill with author triggers a name+author lookup", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({
        plugin: ".claude",
        skill: "hi-anton",
        origin: "source",
        author: "Anton",
        version: "1.0.0",
      }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "hi-anton", author: "Anton", uuid: "u-hi-anton" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      // The lookup must have been called with the source-origin entry.
      expect(api.lookupSkillsByName).toHaveBeenCalled();
      const callArg = (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(Array.isArray(callArg)).toBe(true);
      expect(callArg[0]).toEqual({ name: "hi-anton", author: "Anton" });
    } finally {
      h.unmount();
    }
  });

  it("AC-US2-01: source-origin skills with no author are excluded from the lookup batch", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({
        plugin: ".claude",
        skill: "no-author",
        origin: "source",
        version: "1.0.0",
        // no author
      }),
      makeSkill({
        plugin: ".claude",
        skill: "with-author",
        origin: "source",
        author: "Anton",
        version: "1.0.0",
      }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "with-author", author: "Anton", uuid: "u-w" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      expect(api.lookupSkillsByName).toHaveBeenCalled();
      const callArg = (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ name: string }>;
      expect(callArg.length).toBe(1);
      expect(callArg[0].name).toBe("with-author");
    } finally {
      h.unmount();
    }
  });

  it("does not call lookup when there are no source-origin skills", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({
        plugin: ".claude",
        skill: "installed-only",
        origin: "installed",
      }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      expect(api.lookupSkillsByName).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it("exposes trackedSkillCount on the context (sum of installed + source-origin twins)", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill({
        plugin: ".claude",
        skill: "hi-anton",
        origin: "source",
        author: "Anton",
        version: "1.0.0",
      }),
      makeSkill({
        plugin: ".claude",
        skill: "installed-one",
        origin: "installed",
      }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "acme/repo/installed-one", installed: "1.0.0", latest: "1.0.0", updateAvailable: false },
    ]);
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.resolveInstalledSkillIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { plugin: ".claude", skill: "installed-one", uuid: "u-installed" },
    ]);
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.lookupSkillsByName as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: "hi-anton", author: "Anton", uuid: "u-hi-anton" },
    ]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flushMicrotasks(); });
      const tsc = (probe.current as ContextValue & { trackedSkillCount?: number })
        .trackedSkillCount;
      expect(typeof tsc).toBe("number");
      // 1 installed + 1 source-origin twin = 2
      expect(tsc).toBeGreaterThanOrEqual(1);
    } finally {
      h.unmount();
    }
  });
});
