// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Plugin section empty-state messages must distinguish "no plugins installed"
// from "search filter excludes all installed plugins". Bug surfaced when a
// user with 50 plugin skills installed searched for "frontend" and the
// AVAILABLE > Plugins section misleadingly read "No plugin skills installed
// yet." even though 50 were present.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { SkillInfo } from "../../types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pluginSkill(plugin: string, name: string, scopeV2: string): SkillInfo {
  return {
    plugin,
    skill: name,
    dir: `/home/u/.claude/plugins/cache/${plugin}/${name}`,
    hasEvals: false,
    hasBenchmark: false,
    origin: "installed",
    scope: "installed",
    scopeV2,
    pluginName: plugin,
  } as unknown as SkillInfo;
}

describe("Sidebar plugin section empty-state", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders 'No plugin skills installed yet.' when zero plugin skills exist (no query)", async () => {
    const { Sidebar } = await import("../Sidebar");
    const React = await import("react");

    const html = renderToStaticMarkup(
      React.createElement(Sidebar, {
        skills: [] as SkillInfo[],
        selectedKey: null,
        onSelect: vi.fn(),
        activeAgentId: "claude-code",
      }),
    );

    expect(html).toContain("No plugin skills installed yet.");
  });

  it("renders 'No matches in this section.' when plugin skills exist but search filter excludes all", async () => {
    const { Sidebar } = await import("../Sidebar");
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");

    const skills: SkillInfo[] = [
      pluginSkill("sw", "do", "available-plugin"),
      pluginSkill("sw", "done", "available-plugin"),
      pluginSkill("sw", "increment", "available-plugin"),
    ];

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills,
          selectedKey: null,
          onSelect: vi.fn(),
          activeAgentId: "claude-code",
        }),
      );
    });

    const search = container.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null;
    expect(search).not.toBeNull();

    act(() => {
      // React 19: sync valueTracker via the native setter so onChange fires.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(search!, "frontend");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Flush React's deferred query (useDeferredValue commits in next paint).
    await new Promise((r) => setTimeout(r, 50));
    act(() => {
      // Force a flush via no-op state change.
    });

    const text = container.textContent ?? "";
    expect(text).not.toContain("No plugin skills installed yet.");
    expect(text).toContain("No matches in this section.");

    act(() => root.unmount());
    container.remove();
  });
});
