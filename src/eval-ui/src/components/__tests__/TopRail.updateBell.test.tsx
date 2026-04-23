import { describe, it, expect, vi } from "vitest";

vi.mock("../AgentModelPicker", () => ({
  AgentModelPicker: () =>
    ({ type: "div", props: { "data-slot-marker": "agent-model-picker" } } as unknown),
}));
vi.mock("../UpdateBell", () => ({
  UpdateBell: () =>
    ({ type: "div", props: { "data-slot-marker": "update-bell" } } as unknown),
}));
// 0686 T-001: StudioLogo uses hooks — stub to a plain marker div so the
// manual `expand()` walker doesn't hit a null dispatcher.
vi.mock("../StudioLogo", () => ({
  StudioLogo: () =>
    ({ type: "div", props: { "data-slot-marker": "studio-logo" } } as unknown),
}));

import { TopRail } from "../TopRail";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
    return expand(rendered);
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
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

describe("TopRail.updateBell (0683 T-008)", () => {
  it("mounts <UpdateBell /> inside the right action cluster (between ModelSelector and ⌘K)", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: vi.fn(),
    }));
    const rightCluster = findElements(tree, (el) => el.props?.["data-toprail-right"] === "true");
    expect(rightCluster).toHaveLength(1);
    // Walk the flattened children of the right cluster in DOM order — expect
    // model-selector marker → update-bell marker → a button whose aria-label
    // matches /palette/i.
    const markers: string[] = [];
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const el = n as ReactEl;
      const marker = el.props?.["data-slot-marker"];
      if (typeof marker === "string") markers.push(marker);
      if (el.type === "button") {
        const aria = String(el.props?.["aria-label"] ?? "");
        if (/palette/i.test(aria)) markers.push("palette");
      }
      if (el.props?.children != null) walk(el.props.children);
    };
    walk(rightCluster[0]);
    expect(markers).toEqual(["agent-model-picker", "update-bell", "palette"]);
  });
});
