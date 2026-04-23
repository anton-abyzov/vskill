// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { SkillInfo } from "../../types";
import { VIRTUALIZATION_THRESHOLD } from "../Sidebar";

function makeSkill(origin: "source" | "installed", idx: number): SkillInfo {
  return {
    plugin: `plug-${idx % 10}`,
    skill: `skill-${String(idx).padStart(3, "0")}`,
    dir: `/d/${origin}/${idx}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
  };
}

describe("Sidebar virtualization threshold", () => {
  it("exposes a 200-row virtualization threshold constant", () => {
    expect(VIRTUALIZATION_THRESHOLD).toBe(200);
  });

  it("below threshold: all rows are mounted as plain DOM", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [];
    for (let i = 0; i < 30; i++) skills.push(makeSkill("source", i));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(Sidebar, { skills, selectedKey: null, onSelect: vi.fn() }));
    });

    // Every skill is in the DOM.
    expect(container.querySelectorAll("button[data-origin]").length).toBe(30);

    act(() => root.unmount());
    container.remove();
  });

  it("at/above threshold: does not crash and renders a virtualized surface", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { Sidebar } = await import("../Sidebar");

    const skills: SkillInfo[] = [];
    for (let i = 0; i < 250; i++) {
      skills.push(makeSkill(i < 150 ? "source" : "installed", i));
    }

    const container = document.createElement("div");
    // Force realistic size so virtuoso can compute item heights
    Object.defineProperty(container, "clientHeight", { value: 600, configurable: true });
    Object.defineProperty(container, "offsetHeight", { value: 600, configurable: true });
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(Sidebar, { skills, selectedKey: null, onSelect: vi.fn() }));
    });

    // Even without a real layout, the sidebar must render a scrollable
    // virtualized element when crossing the threshold. The data-virtualized
    // attribute is the hook we assert on.
    const virtual = container.querySelector("[data-virtualized='true']");
    expect(virtual).toBeTruthy();

    act(() => root.unmount());
    container.remove();
  });
});
