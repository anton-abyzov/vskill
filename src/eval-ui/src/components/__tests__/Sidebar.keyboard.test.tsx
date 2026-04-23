// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { SkillInfo } from "../../types";

function skill(plugin: string, name: string, origin: "source" | "installed"): SkillInfo {
  return {
    plugin,
    skill: name,
    dir: `/root/${plugin}/${name}`,
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
  };
}

async function mount(props: {
  skills: SkillInfo[];
  selectedKey: { plugin: string; skill: string } | null;
  onSelect: (s: SkillInfo) => void;
}) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { Sidebar } = await import("../Sidebar");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const latest: { props: typeof props } = { props };

  function Probe({ p }: { p: typeof props }) {
    latest.props = p;
    return React.createElement(Sidebar, {
      skills: p.skills,
      selectedKey: p.selectedKey,
      onSelect: p.onSelect,
    });
  }

  act(() => {
    root.render(React.createElement(Probe, { p: props }));
  });

  return {
    rerender(next: typeof props) {
      latest.props = next;
      act(() => root.render(React.createElement(Probe, { p: next })));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function pressKey(key: string) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
}

describe("Sidebar: j/k/Enter navigation (T-038)", () => {
  const skills: SkillInfo[] = [
    skill("own-a", "alpha", "source"),
    skill("own-a", "beta", "source"),
    skill("own-b", "gamma", "source"),
    skill("inst-a", "delta", "installed"),
    skill("inst-a", "epsilon", "installed"),
  ];

  it("moves selection forward with j across sections", async () => {
    const onSelect = vi.fn();
    const h = await mount({
      skills,
      selectedKey: { plugin: "own-a", skill: "alpha" },
      onSelect,
    });
    try {
      pressKey("j");
      expect(onSelect).toHaveBeenCalled();
      const arg = onSelect.mock.calls[0][0] as SkillInfo;
      // Next in flat list after "alpha" is "beta" in own-a group.
      expect(arg.skill).toBe("beta");
    } finally {
      h.unmount();
    }
  });

  it("moves backward with k", async () => {
    const onSelect = vi.fn();
    const h = await mount({
      skills,
      selectedKey: { plugin: "own-a", skill: "beta" },
      onSelect,
    });
    try {
      pressKey("k");
      const arg = onSelect.mock.calls[0][0] as SkillInfo;
      expect(arg.skill).toBe("alpha");
    } finally {
      h.unmount();
    }
  });

  it("j at the last row stays clamped (no wrap)", async () => {
    const onSelect = vi.fn();
    const h = await mount({
      skills,
      selectedKey: { plugin: "inst-a", skill: "epsilon" },
      onSelect,
    });
    try {
      pressKey("j");
      // Clamped — onSelect fires but returns the same skill at index N-1.
      const arg = onSelect.mock.calls[0][0] as SkillInfo;
      expect(arg.skill).toBe("epsilon");
    } finally {
      h.unmount();
    }
  });

  it("j crosses from OWN into INSTALLED section", async () => {
    const onSelect = vi.fn();
    // Put cursor at last OWN skill ("gamma" in own-b).
    const h = await mount({
      skills,
      selectedKey: { plugin: "own-b", skill: "gamma" },
      onSelect,
    });
    try {
      pressKey("j");
      const arg = onSelect.mock.calls[0][0] as SkillInfo;
      expect(arg.origin).toBe("installed");
      expect(arg.skill).toBe("delta");
    } finally {
      h.unmount();
    }
  });

  it("Enter re-selects current skill", async () => {
    const onSelect = vi.fn();
    const h = await mount({
      skills,
      selectedKey: { plugin: "own-a", skill: "alpha" },
      onSelect,
    });
    try {
      pressKey("Enter");
      const arg = onSelect.mock.calls[0][0] as SkillInfo;
      expect(arg.skill).toBe("alpha");
    } finally {
      h.unmount();
    }
  });

  it("j is suppressed while typing in the search input", async () => {
    const onSelect = vi.fn();
    const h = await mount({
      skills,
      selectedKey: { plugin: "own-a", skill: "alpha" },
      onSelect,
    });
    try {
      const input = document.querySelector("input[type='search']") as HTMLInputElement;
      expect(input).toBeTruthy();
      input.focus();
      const e = new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true });
      input.dispatchEvent(e);
      expect(onSelect).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });
});
