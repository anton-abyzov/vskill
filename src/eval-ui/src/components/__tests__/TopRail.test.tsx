import { describe, it, expect, vi } from "vitest";

// TopRail renders AgentModelPicker (0682), which consumes useAgentCatalog()
// + fetch(). These tests exercise TopRail as a pure function without a
// provider, so we stub the picker to a no-op element.
vi.mock("../AgentModelPicker", () => ({
  AgentModelPicker: () => null,
}));

// 0683 T-008: UpdateBell consumes useStudio() and is lazy-loaded internally.
// Stub it for the TopRail unit tests — coverage lives in UpdateBell.test.tsx.
vi.mock("../UpdateBell", () => ({
  UpdateBell: () => null,
}));

// 0686 T-001: StudioLogo uses useState for hover/focus — TopRail tests call
// components as plain functions without a host, so a stub preserves the
// "Skill Studio" label text for the existing containment assertion while
// the semantic coverage (href, role, keyboard, focus ring) lives in
// StudioLogo.test.tsx.
vi.mock("../StudioLogo", () => ({
  StudioLogo: () => "Skill Studio",
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

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
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

describe("TopRail", () => {
  it("shows the 'Skill Studio' label and project name", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain("Skill Studio");
    expect(text).toContain("vskill");
  });

  // 0709 T-001 / 0700: breadcrumb origin label for source (own) skills is
  // `Skills`. Pre-0700 this was `OWN`; keep the old name-drop in the
  // describe prose so future spelunkers can find this rename.
  it("renders breadcrumb Skills › plugin › skill when a source skill is selected", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "obsidian-brain", skill: "lint", origin: "source" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain("Skills");
    expect(text).toContain("obsidian-brain");
    expect(text).toContain("lint");
  });

  // 0709 T-001 / 0700: breadcrumb origin label for installed skills is
  // `Project` (previously `INSTALLED`).
  it("renders breadcrumb Project when an installed skill is selected", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "obsidian-brain", skill: "lint", origin: "installed" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain("Project");
  });

  it("palette button has aria-label and fires onOpenPalette on click", () => {
    const onOpen = vi.fn();
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      onOpenPalette: onOpen,
    }));
    const buttons = findElements(tree, (el) => el.type === "button" && /palette/i.test(String(el.props["aria-label"] ?? "")));
    expect(buttons.length).toBeGreaterThan(0);
    const btn = buttons[0];
    const onClick = btn.props.onClick as () => void;
    onClick();
    expect(onOpen).toHaveBeenCalled();
  });
});
