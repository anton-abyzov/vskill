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
  it("mounts <UpdateBell /> inside Group B of the right action cluster (after ModelSelector)", () => {
    // 0741 T-018 split the right cluster into Group A (skill actions:
    //   findSkillsSlot → "+ New Skill") and Group B (session status:
    //   ModelSelector → UpdateBell → user dropdown). UpdateBell must sit
    //   immediately after the model-selector inside Group B; the palette
    //   slot lives in Group A and so appears BEFORE Group B in the rail.
    const PALETTE_MARKER = "FIND_SKILLS_SLOT_MARKER";
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      findSkillsSlot: PALETTE_MARKER,
    }));
    const rightCluster = findElements(tree, (el) => el.props?.["data-toprail-right"] === "true");
    expect(rightCluster).toHaveLength(1);
    // Walk in DOM order — expect palette → model-selector → update-bell.
    const markers: string[] = [];
    const walk = (n: unknown) => {
      if (n == null) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (typeof n === "string") {
        if ((n as string).includes(PALETTE_MARKER) && !markers.includes("palette")) markers.push("palette");
        return;
      }
      if (typeof n !== "object") return;
      const el = n as ReactEl;
      const slot = el.props?.["data-slot"];
      if (slot === "agent-model-picker" && !markers.includes("agent-model-picker")) {
        markers.push("agent-model-picker");
      }
      if (slot === "update-bell" && !markers.includes("update-bell")) {
        markers.push("update-bell");
      }
      const slotMarker = el.props?.["data-slot-marker"];
      if (typeof slotMarker === "string" && !markers.includes(slotMarker)) {
        markers.push(slotMarker);
      }
      if (el.props?.children != null) walk(el.props.children);
    };
    walk(rightCluster[0]);
    expect(markers).toEqual(["palette", "agent-model-picker", "update-bell"]);
  });
});
