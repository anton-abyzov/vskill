// @vitest-environment jsdom
// 0780 US-001 — Uninstall button visibility on the read-only banner.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => {
    const React = require("react");
    return React.createElement("div", null, children);
  },
  useWorkspace: () => ({ state: { activePanel: "overview" }, dispatch: () => {} }),
}));
vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({ VersionHistoryPanel: () => null }));
vi.mock("../../pages/workspace/EditorPanel", () => ({ EditorPanel: () => null }));
vi.mock("../../pages/workspace/TestsPanel", () => ({ TestsPanel: () => null }));
vi.mock("../../pages/workspace/RunPanel", () => ({ RunPanel: () => null }));
vi.mock("../../pages/workspace/ActivationPanel", () => ({ ActivationPanel: () => null }));
vi.mock("../../pages/workspace/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../../pages/workspace/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("../../pages/workspace/DepsPanel", () => ({ DepsPanel: () => null }));
vi.mock("../UpdateAction", () => ({ UpdateAction: () => null }));
vi.mock("../CheckNowButton", () => ({ CheckNowButton: () => null }));
vi.mock("../../pages/UpdatesPanel", () => ({ UpdatesPanel: () => null }));
vi.mock("../DetailHeader", () => ({ DetailHeader: () => null }));
vi.mock("../SkillOverview", () => ({ SkillOverview: () => null }));
vi.mock("../../StudioContext", () => ({
  useStudio: () => ({
    state: { skills: [], selectedSkill: null, isMobile: false, mode: "browse", skillsLoading: false, skillsError: null },
    selectSkill: vi.fn(),
    setMode: vi.fn(),
    refreshSkills: vi.fn(),
    setMobileView: vi.fn(),
  }),
}));

interface SkillStub extends Record<string, unknown> {
  plugin: string;
  skill: string;
  origin: "source" | "installed";
  trackedForUpdates?: boolean;
}

async function mountWithSkill(skill: SkillStub) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { RightPanel } = await import("../RightPanel");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(RightPanel, {
        selectedSkillInfo: skill as never,
        activeDetailTab: "overview" as never,
        onDetailTabChange: vi.fn(),
        allSkills: [skill as never],
        onSelectSkill: vi.fn(),
      } as never),
    );
  });
  return {
    container,
    unmount: () => { act(() => root.unmount()); container.remove(); },
  };
}

describe("RightPanel — Uninstall button (0780 US-001)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => vi.clearAllMocks());

  it("AC-US1-01: visible for installed skill with trackedForUpdates=true", async () => {
    const m = await mountWithSkill({
      plugin: "anton-abyzov",
      skill: "greet-anton",
      origin: "installed",
      trackedForUpdates: true,
      dir: "/tmp/x",
      version: "1.0.3",
    });
    const btn = m.container.querySelector("[data-testid='uninstall-button']") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Uninstall greet-anton");
    m.unmount();
  });

  it("AC-US1-02: hidden for plugin-bundled installed skill (trackedForUpdates=false)", async () => {
    const m = await mountWithSkill({
      plugin: "anthropics",
      skill: "skill-creator",
      origin: "installed",
      trackedForUpdates: false,
      dir: "/tmp/x",
    });
    const btn = m.container.querySelector("[data-testid='uninstall-button']");
    expect(btn).toBeFalsy();
    // Read-only banner should still be there.
    expect(m.container.querySelector("[data-testid='read-only-banner']")).toBeTruthy();
    m.unmount();
  });

  it("AC-US1-03: hidden for source-authored skill (origin='source')", async () => {
    const m = await mountWithSkill({
      plugin: "anton-abyzov",
      skill: "my-skill",
      origin: "source",
      trackedForUpdates: false,
      dir: "/tmp/x",
    });
    const btn = m.container.querySelector("[data-testid='uninstall-button']");
    expect(btn).toBeFalsy();
    // Read-only banner is also absent for source skills.
    expect(m.container.querySelector("[data-testid='read-only-banner']")).toBeFalsy();
    m.unmount();
  });

  it("AC-US2-01: clicking dispatches studio:request-uninstall with the skill", async () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event): void => {
      if (e instanceof CustomEvent) events.push(e);
    };
    window.addEventListener("studio:request-uninstall", listener);

    const m = await mountWithSkill({
      plugin: "anton-abyzov",
      skill: "greet-anton",
      origin: "installed",
      trackedForUpdates: true,
      dir: "/tmp/x",
    });
    const btn = m.container.querySelector("[data-testid='uninstall-button']") as HTMLButtonElement;
    btn.click();
    expect(events.length).toBe(1);
    const detail = events[0].detail as { skill: { plugin: string; skill: string; origin: string } };
    expect(detail.skill.plugin).toBe("anton-abyzov");
    expect(detail.skill.skill).toBe("greet-anton");
    expect(detail.skill.origin).toBe("installed");

    window.removeEventListener("studio:request-uninstall", listener);
    m.unmount();
  });
});
