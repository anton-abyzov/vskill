// @vitest-environment jsdom
// 0801: StudioContext URL-hash → SelectedSkill restore. New 3-segment form
// (`#/skills/<source>/<plugin>/<skill>`) carries scope into the breadcrumb;
// legacy 2-segment form falls back to first-match-by-(plugin,skill) and
// derives source from the matched skill's data.
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
      getAgents: vi.fn(),
      // Stubbed via plain async fn so loadSkills' installed-skill resolver
      // doesn't crash when our test data has origin=installed personal skills.
      resolveInstalledSkillIds: async () => [],
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

function makeSkill(plugin: string, skill: string, source: "project" | "personal" | "plugin"): SkillInfo {
  return {
    plugin,
    skill,
    dir: `/fake/${plugin}/${skill}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: source === "project" && plugin === "" ? "source" : "installed",
    source,
    scopeV2: source === "project" ? "available-project" : source === "personal" ? "available-personal" : "available-plugin",
    group: "available",
  } as SkillInfo;
}

describe("StudioContext — scope hash parsing (0801)", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "vskill.studio.prefs",
      JSON.stringify({ activeAgent: "claude-code" }),
    );
    window.location.hash = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.location.hash = "";
  });

  it("AC-US2-02: parses 3-segment hash and selects the matching scope", async () => {
    const { api } = await import("../api");
    const skills = [
      // Same plugin+skill exist in BOTH personal and project to prove scope disambiguates.
      makeSkill("claude-code", "excalidraw-diagram-generator", "project"),
      makeSkill("claude-code", "excalidraw-diagram-generator", "personal"),
    ];
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    window.location.hash = "#/skills/personal/claude-code/excalidraw-diagram-generator";

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flush(); });
      const sel = probe.current?.state.selectedSkill;
      expect(sel).not.toBeNull();
      expect(sel?.plugin).toBe("claude-code");
      expect(sel?.skill).toBe("excalidraw-diagram-generator");
      expect(sel?.source).toBe("personal");
    } finally {
      h.unmount();
    }
  });

  it("AC-US2-03: legacy 2-segment hash falls back to plugin+skill match and derives source", async () => {
    const { api } = await import("../api");
    const skills = [
      makeSkill("claude-code", "frontend-design", "personal"),
    ];
    (api.getSkills as ReturnType<typeof vi.fn>).mockResolvedValue(skills);
    (api.getSkillUpdates as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    // Legacy hash from a pre-0801 bookmark — no source segment.
    window.location.hash = "#/skills/claude-code/frontend-design";

    const probe: { current: ContextValue | null } = { current: null };
    const h = await renderProvider(probe);
    try {
      await h.act(async () => { await flush(); });
      const sel = probe.current?.state.selectedSkill;
      expect(sel).not.toBeNull();
      expect(sel?.plugin).toBe("claude-code");
      expect(sel?.skill).toBe("frontend-design");
      // Source must be filled in from the matched skill, even though the hash
      // didn't carry it.
      expect(sel?.source).toBe("personal");
    } finally {
      h.unmount();
    }
  });
});
