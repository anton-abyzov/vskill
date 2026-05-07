// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { itemsForSkill } from "../ContextMenu";
import type { SkillInfo } from "../../types";

function mkSkill(origin: "source" | "installed", updateAvailable = false): SkillInfo {
  return {
    plugin: "p",
    skill: "s",
    dir: "/x",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
    updateAvailable,
  };
}

describe("ContextMenu: itemsForSkill (pure)", () => {
  it("source skill has Edit + Duplicate; no Update/Uninstall", () => {
    const items = itemsForSkill(mkSkill("source"));
    const actions = items.map((i) => i.action);
    expect(actions).toContain("edit");
    expect(actions).toContain("duplicate");
    expect(actions).not.toContain("update");
    expect(actions).not.toContain("uninstall");
  });

  it("installed + updateAvailable has Update + Uninstall, no Edit/Duplicate", () => {
    const items = itemsForSkill(mkSkill("installed", true));
    const actions = items.map((i) => i.action);
    expect(actions).toContain("update");
    expect(actions).toContain("uninstall");
    expect(actions).not.toContain("edit");
    expect(actions).not.toContain("duplicate");
  });

  it("installed without update hides Update but keeps Uninstall", () => {
    const items = itemsForSkill(mkSkill("installed", false));
    const actions = items.map((i) => i.action);
    expect(actions).not.toContain("update");
    expect(actions).toContain("uninstall");
  });

  it("all skills share the Open / Copy Path / Reveal / Run Benchmark set", () => {
    for (const skill of [mkSkill("source"), mkSkill("installed"), mkSkill("installed", true)]) {
      const a = itemsForSkill(skill).map((i) => i.action);
      expect(a).toContain("open");
      expect(a).toContain("copy-path");
      expect(a).toContain("reveal");
      expect(a).toContain("run-benchmark");
    }
  });

  // 0828 — Clone-to-authoring action. Forks an installed skill into the
  // authoring scope; not relevant for source skills (they're already authored).
  it("installed skill exposes 'clone' (Clone to authoring); source skill does not", () => {
    const installedActions = itemsForSkill(mkSkill("installed")).map((i) => i.action);
    expect(installedActions).toContain("clone");
    const sourceActions = itemsForSkill(mkSkill("source")).map((i) => i.action);
    expect(sourceActions).not.toContain("clone");
  });

  it("clone item is enabled (no disabled flag)", () => {
    const item = itemsForSkill(mkSkill("installed")).find((i) => i.action === "clone");
    expect(item).toBeDefined();
    expect(item?.disabled).toBeFalsy();
  });
});

async function mount(state: {
  open: boolean;
  x: number;
  y: number;
  skill: SkillInfo | null;
}, onClose = vi.fn(), onAction = vi.fn()) {
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { ContextMenu } = await import("../ContextMenu");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(ContextMenu, { state, onClose, onAction }));
  });
  return {
    container,
    onClose,
    onAction,
    rerender(next: typeof state) {
      act(() =>
        root.render(
          React.createElement(ContextMenu, { state: next, onClose, onAction }),
        ),
      );
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("ContextMenu (T-041)", () => {
  it("renders nothing when state.open=false", async () => {
    const h = await mount({ open: false, x: 0, y: 0, skill: mkSkill("source") });
    expect(h.container.querySelector("[data-testid='context-menu']")).toBeNull();
    h.unmount();
  });

  it("renders role=menu with role=menuitem entries when open", async () => {
    const h = await mount({ open: true, x: 100, y: 100, skill: mkSkill("source") });
    expect(h.container.querySelector("[role='menu']")).toBeTruthy();
    const items = h.container.querySelectorAll("[role='menuitem']");
    expect(items.length).toBeGreaterThanOrEqual(4);
    h.unmount();
  });

  it("source skill does NOT render Update or Uninstall entries", async () => {
    const h = await mount({ open: true, x: 0, y: 0, skill: mkSkill("source") });
    const actions = Array.from(
      h.container.querySelectorAll("[role='menuitem']"),
    ).map((n) => n.getAttribute("data-action"));
    expect(actions).not.toContain("update");
    expect(actions).not.toContain("uninstall");
    h.unmount();
  });

  it("installed with updateAvailable shows Update + Uninstall", async () => {
    const h = await mount({
      open: true,
      x: 0,
      y: 0,
      skill: mkSkill("installed", true),
    });
    const actions = Array.from(
      h.container.querySelectorAll("[role='menuitem']"),
    ).map((n) => n.getAttribute("data-action"));
    expect(actions).toContain("update");
    expect(actions).toContain("uninstall");
    expect(actions).not.toContain("edit");
    h.unmount();
  });

  it("Escape closes and calls onClose", async () => {
    const h = await mount({ open: true, x: 0, y: 0, skill: mkSkill("source") });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(h.onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("ArrowDown + Enter invokes the second action", async () => {
    const { act } = await import("react");
    const h = await mount({
      open: true,
      x: 0,
      y: 0,
      skill: mkSkill("source"),
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    // Default source order: open, copy-path, reveal, run-benchmark, edit, duplicate
    expect(h.onAction).toHaveBeenCalledWith("copy-path", expect.anything());
    expect(h.onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("click on an item invokes it with the skill", async () => {
    const skill = mkSkill("installed", true);
    const h = await mount({ open: true, x: 0, y: 0, skill });
    const copyPath = h.container.querySelector("[data-action='copy-path']") as HTMLElement;
    copyPath.click();
    expect(h.onAction).toHaveBeenCalledWith("copy-path", skill);
    expect(h.onClose).toHaveBeenCalled();
    h.unmount();
  });

  it("click outside the menu closes it", async () => {
    const h = await mount({ open: true, x: 0, y: 0, skill: mkSkill("source") });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(h.onClose).toHaveBeenCalled();
    outside.remove();
    h.unmount();
  });

  it("flips left when cursor is near the right viewport edge", async () => {
    // jsdom defaults: 1024x768.
    const h = await mount({
      open: true,
      x: 1020,
      y: 100,
      skill: mkSkill("source"),
    });
    const menu = h.container.querySelector("[data-testid='context-menu']") as HTMLElement;
    // Menu should be positioned to the left of x, i.e., less than x.
    expect(parseInt(menu.style.left, 10)).toBeLessThan(1020);
    h.unmount();
  });
});
