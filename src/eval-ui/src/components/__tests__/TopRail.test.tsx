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
import { strings } from "../../strings";

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

  // 0709 / 0700: keep the retired `OWN` name-drop in the describe prose so
  // future spelunkers grepping for the old vocabulary land here.
  // 0801: per AC-US1-05, the legacy origin='source' fallback (no `source` field
  // on SelectedSkill) renders the "Project" scope label — not the authoring
  // "Skills" label — because user-authored skills live in the project tier.
  it("renders breadcrumb Project › plugin › skill for legacy origin=source fixtures", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "obsidian-brain", skill: "lint", origin: "source" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain(strings.scopeLabels.sourceProject);
    expect(text).toContain("obsidian-brain");
    expect(text).toContain("lint");
  });

  // 0801: header crumb derives from `source` (project|personal|plugin), not
  // the binary `origin`. Pre-0801 this test asserted that any `origin: installed`
  // rendered "Project" — that conflated personal-tier symlinks with project
  // installs. Now we exercise all three sources explicitly + a legacy fallback.
  it("renders breadcrumb Project when source is project", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "obsidian-brain", skill: "lint", origin: "installed", source: "project" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain(strings.scopeLabels.sourceProject);
  });

  it("renders breadcrumb Personal when source is personal (e.g. ~/.agents/skills symlink)", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "claude-code", skill: "excalidraw-diagram-generator", origin: "installed", source: "personal" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain(strings.scopeLabels.sourcePersonal);
    // Defense: must NOT collapse to "Project" the way pre-0801 code did.
    expect(text).not.toMatch(/\bPROJECT\b/);
  });

  it("renders breadcrumb Plugins when source is plugin", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "anthropic-skills", skill: "pdf", origin: "installed", source: "plugin" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain(strings.scopeLabels.sourcePlugin);
  });

  it("falls back to Personal when source is missing and origin=installed (legacy bundles)", () => {
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: { plugin: "obsidian-brain", skill: "lint", origin: "installed" },
      onOpenPalette: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain(strings.scopeLabels.sourcePersonal);
  });

  it("renders the findSkillsSlot when provided (palette trigger now lives in a slot)", () => {
    // The legacy `onOpenPalette` prop was removed in 0741 T-018 — TopRail
    // now exposes `findSkillsSlot: ReactNode` so the host (App.tsx) decides
    // which component renders the ⌘⇧K palette trigger. Coverage for the
    // FindSkillsNavButton lives in its own test file. Here we just verify
    // the slot is rendered into the rail.
    const slotMarker = "FIND_SKILLS_SLOT_MARKER";
    const tree = expand(TopRail({
      projectName: "vskill",
      selected: null,
      findSkillsSlot: slotMarker,
    }));
    const text = collectText(tree);
    expect(text).toContain(slotMarker);
  });
});
