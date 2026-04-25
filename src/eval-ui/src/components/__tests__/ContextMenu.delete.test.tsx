// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ContextMenu: delete action (0722)
//
// Behavior:
//   - source-origin skills (and authoring-* scopes) get an enabled `Delete`
//     menu item.
//   - installed (plugin) skills get a `Delete` item rendered DISABLED with a
//     tooltip explaining that the plugin's owner manages it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { itemsForSkill } from "../ContextMenu";
import type { SkillInfo, SkillScope } from "../../types";

function mkSkill(opts: {
  origin: "source" | "installed";
  scopeV2?: SkillScope;
  updateAvailable?: boolean;
}): SkillInfo {
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
    origin: opts.origin,
    scopeV2: opts.scopeV2,
    updateAvailable: opts.updateAvailable,
  } as SkillInfo;
}

describe("ContextMenu: delete action (0722)", () => {
  it("source skill exposes an enabled Delete item", () => {
    const items = itemsForSkill(
      mkSkill({ origin: "source", scopeV2: "authoring-project" }),
    );
    const del = items.find((i) => i.action === "delete");
    expect(del).toBeTruthy();
    expect(del?.disabled).not.toBe(true);
  });

  it("authoring-plugin skill (user authoring inside plugin source) is deletable", () => {
    const items = itemsForSkill(
      mkSkill({ origin: "source", scopeV2: "authoring-plugin" }),
    );
    const del = items.find((i) => i.action === "delete");
    expect(del).toBeTruthy();
    expect(del?.disabled).not.toBe(true);
  });

  it("available-personal skill (user-owned) is deletable", () => {
    const items = itemsForSkill(
      mkSkill({ origin: "source", scopeV2: "available-personal" }),
    );
    const del = items.find((i) => i.action === "delete");
    expect(del).toBeTruthy();
    expect(del?.disabled).not.toBe(true);
  });

  it("available-plugin skill renders Delete DISABLED with explanatory tooltip", () => {
    const items = itemsForSkill(
      mkSkill({ origin: "installed", scopeV2: "available-plugin" }),
    );
    const del = items.find((i) => i.action === "delete");
    expect(del).toBeTruthy();
    expect(del?.disabled).toBe(true);
    expect(del?.title ?? "").toMatch(/uninstall the plugin/i);
  });

  it("legacy installed skill (no scopeV2) still renders Delete DISABLED", () => {
    const items = itemsForSkill(mkSkill({ origin: "installed" }));
    const del = items.find((i) => i.action === "delete");
    expect(del).toBeTruthy();
    expect(del?.disabled).toBe(true);
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
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("ContextMenu DOM: delete (0722)", () => {
  it("renders the disabled Delete with aria-disabled and title for plugin skills", async () => {
    const h = await mount({
      open: true,
      x: 0,
      y: 0,
      skill: mkSkill({ origin: "installed", scopeV2: "available-plugin" }),
    });
    const del = h.container.querySelector(
      "[role='menuitem'][data-action='delete']",
    ) as HTMLElement | null;
    expect(del).toBeTruthy();
    expect(del!.getAttribute("aria-disabled")).toBe("true");
    expect((del!.getAttribute("title") ?? "")).toMatch(/uninstall the plugin/i);
    h.unmount();
  });

  it("clicking enabled Delete invokes onAction('delete', skill)", async () => {
    const onAction = vi.fn();
    const skill = mkSkill({ origin: "source", scopeV2: "available-personal" });
    const h = await mount(
      { open: true, x: 0, y: 0, skill },
      vi.fn(),
      onAction,
    );
    const del = h.container.querySelector(
      "[role='menuitem'][data-action='delete']",
    ) as HTMLElement;
    del.click();
    expect(onAction).toHaveBeenCalledWith("delete", skill);
    h.unmount();
  });

  it("clicking the disabled Delete on a plugin skill is a no-op", async () => {
    const onAction = vi.fn();
    const skill = mkSkill({ origin: "installed", scopeV2: "available-plugin" });
    const h = await mount(
      { open: true, x: 0, y: 0, skill },
      vi.fn(),
      onAction,
    );
    const del = h.container.querySelector(
      "[role='menuitem'][data-action='delete']",
    ) as HTMLElement;
    del.click();
    expect(onAction).not.toHaveBeenCalled();
    h.unmount();
  });
});
