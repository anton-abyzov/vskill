// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { SkillInfo } from "../../types";

function makeSkill(plugin: string, skill: string, origin: "source" | "installed"): SkillInfo {
  return {
    plugin,
    skill,
    dir: origin === "installed" ? `/home/u/.claude/skills/${plugin}/${skill}` : `/home/u/plugins/${plugin}/${skill}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
  };
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders OWN above INSTALLED with correct counts", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      makeSkill("obsidian-brain", "lint", "source"),
      makeSkill("obsidian-brain", "query", "source"),
      makeSkill("obsidian-brain", "install", "installed"),
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
    expect(iOwn).toBeGreaterThanOrEqual(0);
    expect(iInstalled).toBeGreaterThan(iOwn);
    // counts
    expect(text).toContain("(2)");
    expect(text).toContain("(1)");

    act(() => root.unmount());
    container.remove();
  });

  it("shows source empty-state message when no own skills", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [makeSkill("foo", "a", "installed")];

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

    expect(container.textContent).toContain("No skills yet");

    act(() => root.unmount());
    container.remove();
  });

  it("shows installed empty-state hint when no installed skills", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [makeSkill("foo", "a", "source")];

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

    expect(container.textContent?.toLowerCase()).toContain("vskill install");

    act(() => root.unmount());
    container.remove();
  });

  it("filters by search across both sections", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [
      makeSkill("obsidian-brain", "obsidian-lint", "source"),
      makeSkill("obsidian-brain", "query", "source"),
      makeSkill("obsidian-brain", "obsidian-install", "installed"),
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

    // type "obsidian-lint" in the search input
    const input = container.querySelector("input[type='search']") as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "obsidian-lint");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const text = container.textContent ?? "";
    expect(text).toContain("obsidian-lint");
    expect(text).not.toContain("query");

    act(() => root.unmount());
    container.remove();
  });
});
