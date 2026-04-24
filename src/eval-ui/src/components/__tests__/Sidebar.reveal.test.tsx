// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0704: Sidebar reveal effect — when revealSkillId is set, Sidebar must:
// (a) force-open the AUTHORING group + matching sub-section + plugin subtree,
// (b) scroll the matching row into view via scrollIntoView,
// (c) invoke onRevealComplete so the provider clears revealSkillId,
// (d) leave the user's localStorage preferences untouched.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import type { SkillInfo } from "../../types";

function authoringPluginSkill(pluginName: string, skill: string): SkillInfo {
  return {
    plugin: pluginName,
    skill,
    dir: `/proj/plugins/${pluginName}/${skill}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    scopeV2: "authoring-plugin",
    group: "authoring",
    source: "plugin",
    pluginName,
    pluginNamespace: `${pluginName}:${skill}`,
  } as unknown as SkillInfo;
}

function authoringProjectSkill(plugin: string, skill: string): SkillInfo {
  return {
    plugin,
    skill,
    dir: `/proj/.claude/skills/${plugin}/${skill}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "source",
    scopeV2: "authoring-project",
    group: "authoring",
    source: "project",
    pluginName: null,
  } as unknown as SkillInfo;
}

describe("Sidebar — reveal effect (0704)", () => {
  const origScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    // Stub /api/plugins so the useSWR call resolves (agentId="claude-code")
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ plugins: [] }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = origScrollIntoView;
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it("force-opens AUTHORING + plugin subtree and scrolls the reveal row", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      authoringPluginSkill("test-plugin", "test-plugin-skill"),
    ];

    // Pre-collapse every level so reveal has to force them open.
    localStorage.setItem("vskill-sidebar-claude-code-group-authoring-collapsed", "true");
    localStorage.setItem("vskill-sidebar-claude-code-authoring-project-collapsed", "true");
    localStorage.setItem("vskill-sidebar-claude-code-authoring-plugin-collapsed", "true");
    localStorage.setItem("vskill-plugin-authoring-test-plugin-collapsed", "true");

    const onRevealComplete = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(Sidebar, {
          skills,
          selectedKey: null,
          onSelect: vi.fn(),
          activeAgentId: "claude-code",
          revealSkillId: "test-plugin/test-plugin-skill",
          onRevealComplete,
        }),
      );
    });

    // Row must be rendered (all ancestors force-opened)
    const row = container.querySelector('[data-skill-id="test-plugin/test-plugin-skill"]');
    expect(row).not.toBeNull();

    // scrollIntoView called exactly once
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    // onRevealComplete fired so provider can clear revealSkillId
    expect(onRevealComplete).toHaveBeenCalledTimes(1);

    // User preference untouched — localStorage still records collapsed=true
    expect(localStorage.getItem("vskill-sidebar-claude-code-group-authoring-collapsed")).toBe("true");
    expect(localStorage.getItem("vskill-sidebar-claude-code-authoring-plugin-collapsed")).toBe("true");
    expect(localStorage.getItem("vskill-plugin-authoring-test-plugin-collapsed")).toBe("true");

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("force-opens standalone bucket + scrolls row when reveal targets a project skill", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      authoringProjectSkill(".CLAUDE", "scout"),
    ];

    localStorage.setItem("vskill-sidebar-claude-code-group-authoring-collapsed", "true");
    localStorage.setItem("vskill-sidebar-claude-code-authoring-project-collapsed", "true");

    const onRevealComplete = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        React.createElement(Sidebar, {
          skills,
          selectedKey: null,
          onSelect: vi.fn(),
          activeAgentId: "claude-code",
          revealSkillId: ".CLAUDE/scout",
          onRevealComplete,
        }),
      );
    });

    const row = container.querySelector('[data-skill-id=".CLAUDE/scout"]');
    expect(row).not.toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onRevealComplete).toHaveBeenCalledTimes(1);

    await act(async () => { root.unmount(); });
    container.remove();
  });

  it("does not scroll when revealSkillId is null", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      authoringPluginSkill("test-plugin", "test-plugin-skill"),
    ];

    const onRevealComplete = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // Leave AUTHORING section collapsed so the row isn't rendered.
    localStorage.setItem("vskill-sidebar-claude-code-group-authoring-collapsed", "true");

    await act(async () => {
      root.render(
        React.createElement(Sidebar, {
          skills,
          selectedKey: null,
          onSelect: vi.fn(),
          activeAgentId: "claude-code",
          revealSkillId: null,
          onRevealComplete,
        }),
      );
    });

    expect(container.querySelector('[data-skill-id="test-plugin/test-plugin-skill"]')).toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(onRevealComplete).not.toHaveBeenCalled();

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
