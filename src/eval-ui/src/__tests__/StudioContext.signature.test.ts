// @vitest-environment jsdom
// F-001: resolver effect must NOT call api.resolveInstalledSkillIds when the
// installed-skill signature is unchanged. The bug: skillUpdates.updates is a
// fresh array reference on every poll cycle, triggering the effect and issuing
// redundant /api/v1/skills/check-updates POSTs. The fix: compare a stable
// content-based signature before issuing the fetch.
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
type SkillUpdateInfo = import("../api").SkillUpdateInfo;

const resolveInstalledSkillIdsSpy = vi.fn(async () => []);

// Control the updates value returned by useSkillUpdates.
let currentUpdates: SkillUpdateInfo[] = [];

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getSkills: vi.fn(),
      getSkillUpdates: vi.fn(),
      resolveInstalledSkillIds: resolveInstalledSkillIdsSpy,
    },
  };
});

// Control what useSkillUpdates returns per render by using a module-level ref.
// Each call to useSkillUpdates in the component will read currentUpdates.
vi.mock("../hooks/useSkillUpdates", () => {
  const React = require("react");
  return {
    useSkillUpdates: () => {
      // Use state to allow triggering re-renders with new updates.
      const [updates, setUpdates] = React.useState(() => currentUpdates);
      // Expose setter through a window property so tests can trigger re-renders.
      React.useEffect(() => {
        (window as unknown as { __setSkillUpdates?: (u: SkillUpdateInfo[]) => void }).__setSkillUpdates = setUpdates;
      });
      return {
        updates,
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
    origin: "installed",
    currentVersion: "1.0.0",
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
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

type SetUpdates = (u: SkillUpdateInfo[]) => void;

function getSetUpdates(): SetUpdates {
  return (window as unknown as { __setSkillUpdates?: SetUpdates }).__setSkillUpdates!;
}

describe("StudioContext — resolver effect signature short-circuit (F-001)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    resolveInstalledSkillIdsSpy.mockClear();
    resolveInstalledSkillIdsSpy.mockResolvedValue([]);
    currentUpdates = [];
    delete (window as unknown as { __setSkillUpdates?: SetUpdates }).__setSkillUpdates;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT re-call resolveInstalledSkillIds when skillUpdates fires with new array reference but same content", async () => {
    const { api } = await import("../api");
    const installedSkills = [
      makeSkill({ plugin: "pa", skill: "greet", origin: "installed", currentVersion: "1.0.0" }),
    ];
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue(installedSkills);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const updateEntry: SkillUpdateInfo = {
      name: "pa/repo/greet",
      installed: "1.0.0",
      latest: "2.0.0",
      updateAvailable: true,
    };
    currentUpdates = [{ ...updateEntry }];

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);

    try {
      await h.act(async () => { await flushMicrotasks(); });
      const callsAfterMount = resolveInstalledSkillIdsSpy.mock.calls.length;
      expect(callsAfterMount).toBeGreaterThanOrEqual(1);

      const setUpdates = getSetUpdates();
      expect(setUpdates).toBeDefined();

      // Simulate 3 poll cycles: call setUpdates with new array reference, same content.
      const { act } = await import("react");
      for (let cycle = 0; cycle < 3; cycle++) {
        await act(async () => {
          setUpdates([{ ...updateEntry }]); // new reference, same content
          await flushMicrotasks();
        });
      }

      const callsAfterPolls = resolveInstalledSkillIdsSpy.mock.calls.length;
      // F-001 fix: signature unchanged → must NOT re-fire.
      expect(callsAfterPolls).toBe(callsAfterMount);
    } finally {
      h.unmount();
    }
  });

  it("uses frontmatter `version` (then `pluginVersion`) before defaulting to 0.0.0", async () => {
    // 0741 fix: the resolver was sending currentVersion: "0.0.0" for every
    // installed skill that lacked a polling-derived `installed` value (i.e.
    // every skill the platform doesn't yet track). Result: the user's
    // /api/v1/skills/check-updates payload had 63 entries all at "0.0.0",
    // making cache keys collide and surface as meaningless to the platform.
    // The frontmatter `version` (already on SkillInfo from /api/skills) AND
    // the plugin's own `pluginVersion` (1.0.0 etc.) are accurate fallbacks
    // that the resolver should prefer over the literal "0.0.0".
    const { api } = await import("../api");
    const installedSkills = [
      // Skill with frontmatter version → MUST use it.
      makeSkill({
        plugin: "p1",
        skill: "with-fm",
        origin: "installed",
        currentVersion: undefined,
        version: "2.4.1",
      }),
      // Skill with no frontmatter but plugin version → MUST use plugin version.
      makeSkill({
        plugin: "p2",
        skill: "with-plugin",
        origin: "installed",
        currentVersion: undefined,
        version: null,
        pluginVersion: "1.5.0",
      }),
      // Skill with neither → falls back to "0.0.0" (existing contract).
      makeSkill({
        plugin: "p3",
        skill: "neither",
        origin: "installed",
        currentVersion: undefined,
        version: null,
        pluginVersion: null,
      }),
    ];
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue(installedSkills);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);

    try {
      await h.act(async () => { await flushMicrotasks(); });

      expect(resolveInstalledSkillIdsSpy).toHaveBeenCalled();
      const lastCall = resolveInstalledSkillIdsSpy.mock.calls[
        resolveInstalledSkillIdsSpy.mock.calls.length - 1
      ];
      const payload = lastCall[0] as Array<{ skill: string; currentVersion: string }>;
      const byShort = new Map(payload.map((p) => [p.skill, p.currentVersion]));

      expect(byShort.get("with-fm")).toBe("2.4.1");
      expect(byShort.get("with-plugin")).toBe("1.5.0");
      expect(byShort.get("neither")).toBe("0.0.0");
    } finally {
      h.unmount();
    }
  });

  it("DOES call resolveInstalledSkillIds when a new installed skill appears", async () => {
    const { api } = await import("../api");
    const getSkillsMock = api.getSkills as ReturnType<typeof vi.fn>;

    const initialSkills = [
      makeSkill({ plugin: "pa", skill: "greet", origin: "installed", currentVersion: "1.0.0" }),
    ];
    getSkillsMock.mockResolvedValue(initialSkills);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    currentUpdates = [];

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);

    try {
      await h.act(async () => { await flushMicrotasks(); });
      const callsBefore = resolveInstalledSkillIdsSpy.mock.calls.length;

      // Add a second installed skill — signature must change.
      const expandedSkills = [
        ...initialSkills,
        makeSkill({ plugin: "pb", skill: "pm", origin: "installed", currentVersion: "2.0.0" }),
      ];
      getSkillsMock.mockResolvedValue(expandedSkills);

      await h.act(async () => {
        probe.current!.refreshSkills();
        await flushMicrotasks();
        await flushMicrotasks();
      });

      const callsAfter = resolveInstalledSkillIdsSpy.mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    } finally {
      h.unmount();
    }
  });
});
