// @vitest-environment jsdom
// 0704: revealSkill/clearReveal semantics — explicit reveal sets
// revealSkillId and selects the skill; plain selectSkill does not.
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

describe("StudioContext — revealSkill / clearReveal (0704)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function seedProvider() {
    const { api } = await import("../api");
    const skills = [
      makeSkill({ plugin: "p-alpha", skill: "alpha", origin: "source" }),
      makeSkill({ plugin: "p-beta", skill: "beta", origin: "installed" }),
    ];
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkills as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.getSkillUpdates as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    await h.act(async () => { await flushMicrotasks(); });
    return { h, probe };
  }

  it("revealSkill selects the skill AND sets revealSkillId", async () => {
    const { h, probe } = await seedProvider();
    try {
      await h.act(async () => {
        probe.current!.revealSkill("p-alpha", "alpha");
        await flushMicrotasks();
      });
      expect(probe.current!.state.selectedSkill).toEqual({
        plugin: "p-alpha",
        skill: "alpha",
        origin: "source",
      });
      expect(probe.current!.state.revealSkillId).toBe("p-alpha/alpha");
    } finally {
      h.unmount();
    }
  });

  it("clearReveal resets revealSkillId to null, preserves selectedSkill", async () => {
    const { h, probe } = await seedProvider();
    try {
      await h.act(async () => {
        probe.current!.revealSkill("p-alpha", "alpha");
        await flushMicrotasks();
      });
      expect(probe.current!.state.revealSkillId).toBe("p-alpha/alpha");

      await h.act(async () => {
        probe.current!.clearReveal();
        await flushMicrotasks();
      });
      expect(probe.current!.state.revealSkillId).toBeNull();
      expect(probe.current!.state.selectedSkill).toEqual({
        plugin: "p-alpha",
        skill: "alpha",
        origin: "source",
      });
    } finally {
      h.unmount();
    }
  });

  it("selectSkill alone does NOT set revealSkillId", async () => {
    const { h, probe } = await seedProvider();
    try {
      await h.act(async () => {
        probe.current!.selectSkill({ plugin: "p-alpha", skill: "alpha", origin: "source" });
        await flushMicrotasks();
      });
      expect(probe.current!.state.selectedSkill).toEqual({
        plugin: "p-alpha",
        skill: "alpha",
        origin: "source",
      });
      expect(probe.current!.state.revealSkillId).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it("revealSkill defaults to origin=source when skill not in list", async () => {
    const { h, probe } = await seedProvider();
    try {
      await h.act(async () => {
        probe.current!.revealSkill("ghost-plugin", "ghost-skill");
        await flushMicrotasks();
      });
      expect(probe.current!.state.selectedSkill).toEqual({
        plugin: "ghost-plugin",
        skill: "ghost-skill",
        origin: "source",
      });
      expect(probe.current!.state.revealSkillId).toBe("ghost-plugin/ghost-skill");
    } finally {
      h.unmount();
    }
  });
});
