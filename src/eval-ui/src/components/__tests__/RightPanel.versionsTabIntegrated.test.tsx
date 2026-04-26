// @vitest-environment jsdom
// 0779 hotfix — regression test for RightPanel.renderDetailShell forwarding
// the `integrated` arg correctly to renderSkillDetail. Before the fix,
// `integrated` was passed in the `sub` slot (positional-args bug at line 326),
// which made every non-overview tab render the "Select a skill from the
// sidebar to load its <X> view." fallback in production (App.tsx:560 always
// supplies selectedSkillInfo, hitting the renderDetailShell path).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Stub everything heavyweight so the workspace body can mount.
vi.mock("../../pages/workspace/WorkspaceContext", () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => {
    const React = require("react");
    return React.createElement(
      "div",
      { "data-testid": "stub-workspace-provider" },
      children,
    );
  },
  useWorkspace: () => ({ state: { activePanel: "versions" }, dispatch: () => {} }),
}));
vi.mock("../../pages/workspace/VersionHistoryPanel", () => ({
  VersionHistoryPanel: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "stub-version-history-panel" }, "stub-versions-body");
  },
}));
vi.mock("../../pages/workspace/EditorPanel", () => ({ EditorPanel: () => null }));
vi.mock("../../pages/workspace/TestsPanel", () => ({ TestsPanel: () => null }));
vi.mock("../../pages/workspace/RunPanel", () => ({ RunPanel: () => null }));
vi.mock("../../pages/workspace/ActivationPanel", () => ({ ActivationPanel: () => null }));
vi.mock("../../pages/workspace/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("../../pages/workspace/LeaderboardPanel", () => ({ LeaderboardPanel: () => null }));
vi.mock("../../pages/workspace/DepsPanel", () => ({ DepsPanel: () => null }));
vi.mock("../UpdateAction", () => ({ UpdateAction: () => null }));
vi.mock("../CheckNowButton", () => ({ CheckNowButton: () => null }));
vi.mock("../UpdatesPanel", () => ({ UpdatesPanel: () => null }), { virtual: true });
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

interface SkillStub {
  plugin: string;
  skill: string;
  origin: "source" | "installed";
}

async function mountRightPanel(activeDetailTab: string) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { RightPanel } = await import("../RightPanel");

  const skill: SkillStub & Record<string, unknown> = {
    plugin: "greet-anton",
    skill: "greet-anton",
    origin: "installed",
    homepage: null,
    version: "1.0.3",
    versionSource: "frontmatter",
    pluginName: "greet-anton",
  };

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(RightPanel, {
        selectedSkillInfo: skill as never,
        activeDetailTab: activeDetailTab as never,
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

describe("RightPanel — integrated arg propagation (0779 hotfix)", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => vi.clearAllMocks());

  it("Versions tab renders VersionHistoryPanel (NOT the 'Select a skill' fallback) when allSkills + onSelectSkill are provided", async () => {
    const m = await mountRightPanel("versions");
    expect(m.container.querySelector("[data-testid='stub-version-history-panel']")).toBeTruthy();
    expect(m.container.textContent ?? "").not.toContain("Select a skill from the sidebar to load its");
    m.unmount();
  });
});
