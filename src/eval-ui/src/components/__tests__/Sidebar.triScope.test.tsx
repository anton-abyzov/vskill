// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillInfo } from "../../types";

function makeSkill(
  plugin: string,
  skill: string,
  scope: "own" | "installed" | "global",
): SkillInfo {
  const origin = scope === "own" ? "source" : "installed";
  const baseDir =
    scope === "global"
      ? `/home/u/.claude/skills/${plugin}/${skill}`
      : scope === "installed"
        ? `/root/proj/.claude/skills/${plugin}/${skill}`
        : `/root/proj/plugins/${plugin}/${skill}`;
  return {
    plugin,
    skill,
    dir: baseDir,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
    scope,
  };
}

// ---------------------------------------------------------------------------
// 0686 T-007 / T-009 (US-003, US-004): Sidebar renders three scope sections
// OWN → INSTALLED → GLOBAL when skills carry `scope` fields. The 3px bold
// divider sits between each pair.
// ---------------------------------------------------------------------------

describe("0686 Sidebar tri-scope rendering", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders three scope sections in order: own → installed → global", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      makeSkill("p", "a", "own"),
      makeSkill("p", "b", "own"),
      makeSkill("p", "c", "installed"),
      makeSkill("p", "d", "global"),
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
        }),
      );
    });

    const text = container.textContent ?? "";
    const iOwn = text.indexOf("Own");
    const iInstalled = text.indexOf("Installed");
    const iGlobal = text.indexOf("Global");
    // 0698 T-009: new two-tier order is AVAILABLE (Installed, Global) first,
    // then AUTHORING (Own). The legacy sub-section labels still render inside
    // the ScopeSections — but their order has flipped.
    expect(iInstalled).toBeGreaterThanOrEqual(0);
    expect(iGlobal).toBeGreaterThan(iInstalled);
    expect(iOwn).toBeGreaterThan(iGlobal);

    // Counts
    expect(text).toContain("(2)"); // own
    expect(text).toContain("(1)"); // installed (and global)

    act(() => root.unmount());
    container.remove();
  });

  it("renders a 3px bold divider between each section", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills: [makeSkill("p", "a", "own"), makeSkill("p", "b", "installed"), makeSkill("p", "c", "global")],
          selectedKey: null,
          onSelect: vi.fn(),
        }),
      );
    });

    // 0698 T-009: two-tier restructure — only ONE bold divider now, between
    // the AVAILABLE group (Installed + Global wrapped together) and the
    // AUTHORING group (Own). Sub-sections inside AVAILABLE no longer have a
    // divider between them because the GroupHeader provides the visual group.
    const dividers = container.querySelectorAll("[data-testid='scope-bold-divider']");
    expect(dividers.length).toBe(1);
    const d0 = dividers[0] as HTMLElement;
    expect(d0.style.height).toBe("3px");
    expect(d0.style.background).toContain("--color-rule");

    act(() => root.unmount());
    container.remove();
  });

  it("GLOBAL section empty state mentions vskill install --global", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills: [makeSkill("p", "a", "own")],
          selectedKey: null,
          onSelect: vi.fn(),
          activeAgentId: "claude-cli",
        }),
      );
    });
    expect(container.textContent).toContain("vskill install --global");
    act(() => root.unmount());
    container.remove();
  });

  it("legacy 2-section path is preserved when no skill carries a scope", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");
    const legacy: SkillInfo = {
      plugin: "p",
      skill: "a",
      dir: "/x",
      hasEvals: false,
      hasBenchmark: false,
      evalCount: 0,
      assertionCount: 0,
      benchmarkStatus: "missing",
      lastBenchmark: null,
      origin: "source",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        React.createElement(Sidebar, {
          skills: [legacy],
          selectedKey: null,
          onSelect: vi.fn(),
        }),
      );
    });
    // Legacy path: no bold divider, no Global section heading.
    expect(container.querySelector("[data-testid='scope-bold-divider']")).toBeFalsy();
    expect(container.textContent).not.toContain("Global");
    act(() => root.unmount());
    container.remove();
  });
});
