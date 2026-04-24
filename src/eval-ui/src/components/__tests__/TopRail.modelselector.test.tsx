// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-059..T-061: TopRail — breadcrumb links, model selector slot,
//               theme toggle verification.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

// Mock AgentModelPicker (0682) so TopRail can be rendered without the full
// useAgentCatalog/useCredentialStorage hook graph. We assert on its presence
// and position via the mock's data-testid.
vi.mock("../AgentModelPicker", () => ({
  AgentModelPicker: () =>
    ({ type: "div", props: { "data-testid": "agent-model-picker-mock" } } as unknown),
}));

// 0683 T-008: UpdateBell is new in TopRail; stub so this structural test
// continues to render without a StudioContext.
vi.mock("../UpdateBell", () => ({
  UpdateBell: () =>
    ({ type: "div", props: { "data-testid": "update-bell-mock" } } as unknown),
}));

// The StatusBar consumes useTheme() which expects a ThemeProvider above it.
// For T-061 we only care about structural presence of the theme-toggle
// button, so a bare context stub is enough.
vi.mock("../../theme/useTheme", () => ({
  useTheme: () => ({ mode: "auto", setTheme: () => {} }),
}));

import { TopRail } from "../TopRail";
import { StatusBar } from "../StatusBar";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      return expand(rendered);
    } catch {
      // Function components that need a render context (ThemeProvider etc.)
      // are left un-expanded; we still walk their props.children below.
      return el;
    }
  }
  if (el.props?.children != null) {
    return { ...el, props: { ...el.props, children: expand(el.props.children) } };
  }
  return el;
}

function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findElements(el.props.children, match));
  return out;
}

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

// ---------------------------------------------------------------------------
// T-059 — Breadcrumb segments are clickable and dispatch navigation events
// ---------------------------------------------------------------------------
describe("T-059 TopRail — breadcrumb navigation", () => {
  // 0709 T-002 / 0700: the origin segment for a source skill renders the
  // `Skills` label (post-0700 vocabulary; was `OWN` before).
  it("Skills origin segment is a button-like element with an onClick handler", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "google-workspace", skill: "gws", origin: "source" },
      onOpenPalette: vi.fn(),
    }));
    const segments = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-breadcrumb-segment"] === "origin" && typeof attrs.onClick === "function";
    });
    expect(segments.length).toBe(1);
    expect(collectText(segments[0])).toContain("Skills");
  });

  it("clicking the ORIGIN segment dispatches studio:navigate-scope with scope=origin", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "google-workspace", skill: "gws", origin: "installed" },
      onOpenPalette: vi.fn(),
    }));
    const origin = findElements(tree, (el) =>
      el.props["data-breadcrumb-segment"] === "origin",
    )[0];
    (origin.props.onClick as () => void)();
    const event = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:navigate-scope");
    expect(event).toBeTruthy();
    const detail = event!.detail as { scope: string; origin: string };
    expect(detail.scope).toBe("origin");
    expect(detail.origin).toBe("installed");
    dispatchSpy.mockRestore();
  });

  it("clicking the PLUGIN segment dispatches studio:navigate-scope with scope=plugin", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "google-workspace", skill: "gws", origin: "source" },
      onOpenPalette: vi.fn(),
    }));
    const plugin = findElements(tree, (el) =>
      el.props["data-breadcrumb-segment"] === "plugin",
    )[0];
    (plugin.props.onClick as () => void)();
    const event = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:navigate-scope");
    expect(event).toBeTruthy();
    const detail = event!.detail as { scope: string; plugin: string };
    expect(detail.scope).toBe("plugin");
    expect(detail.plugin).toBe("google-workspace");
    dispatchSpy.mockRestore();
  });

  it("SKILL (current) segment is NOT clickable — it's the current view", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "google-workspace", skill: "gws", origin: "source" },
      onOpenPalette: vi.fn(),
    }));
    const skillSeg = findElements(tree, (el) =>
      el.props["data-breadcrumb-segment"] === "skill",
    )[0];
    expect(skillSeg).toBeTruthy();
    expect(skillSeg.props.onClick).toBeUndefined();
  });

  it("shows no breadcrumb navigation segments when nothing is selected", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: vi.fn(),
    }));
    const segs = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return typeof attrs["data-breadcrumb-segment"] === "string";
    });
    expect(segs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// T-060 — Model selector wired into the TopRail right-side actions
// ---------------------------------------------------------------------------
describe("T-060 TopRail — model selector wiring", () => {
  it("renders the ModelSelector slot in the right-side action cluster", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: vi.fn(),
    }));
    const slot = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-slot"] === "agent-model-picker";
    });
    expect(slot.length).toBe(1);
  });

  it("the model-selector slot is positioned before the command palette button", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: vi.fn(),
    }));
    const rightGroup = findElements(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-toprail-right"] === "true";
    })[0];
    expect(rightGroup).toBeTruthy();
    const childrenArr = Array.isArray(rightGroup.props.children)
      ? rightGroup.props.children
      : [rightGroup.props.children];
    const slotIndex = childrenArr.findIndex(
      (c) => c && typeof c === "object" && (c as ReactEl).props?.["data-slot"] === "agent-model-picker",
    );
    const paletteIndex = childrenArr.findIndex(
      (c) =>
        c &&
        typeof c === "object" &&
        (c as ReactEl).type === "button" &&
        /palette/i.test(String((c as ReactEl).props?.["aria-label"] ?? "")),
    );
    expect(slotIndex).toBeGreaterThanOrEqual(0);
    expect(paletteIndex).toBeGreaterThanOrEqual(0);
    expect(slotIndex).toBeLessThan(paletteIndex);
  });
});

// ---------------------------------------------------------------------------
// T-061 — Theme toggle is rendered and reachable from the chrome
// ---------------------------------------------------------------------------
describe("T-061 — Theme toggle visibility", () => {
  it("StatusBar exposes a theme-toggle button with a discoverable aria-label", () => {
    const rendered = expand(StatusBar({ projectPath: "/tmp/vskill", modelName: "claude-4.6" }));
    const toggles = findElements(rendered, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "theme-toggle";
    });
    expect(toggles.length).toBe(1);
    expect(String(toggles[0].props["aria-label"] ?? "")).toMatch(/theme/i);
  });
});
