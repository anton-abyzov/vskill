import { describe, it, expect, vi } from "vitest";
import { PluginGroup } from "../PluginGroup";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
    return expand(rendered);
  }
  // 0683 T-004: step through React.memo-wrapped components so children
  // of memo'd SkillRows still flow into the assertion pipeline.
  if (el.type && typeof el.type === "object") {
    const memoInner = (el.type as { type?: unknown }).type;
    if (typeof memoInner === "function") {
      const rendered = (memoInner as (props: Record<string, unknown>) => unknown)(el.props);
      return expand(rendered);
    }
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
  return el.props?.children != null ? collectText(el.props.children) : "";
}

function makeSkill(
  plugin: string,
  skill: string,
  origin: "source" | "installed" = "source",
  pluginDisplay?: string,
): SkillInfo {
  return {
    plugin, skill,
    dir: `/plugins/${plugin}/${skill}`,
    hasEvals: false, hasBenchmark: false,
    evalCount: 0, assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin,
    ...(pluginDisplay ? { pluginDisplay } : {}),
  };
}

describe("PluginGroup", () => {
  it("renders the plugin name as a header and the contained skill names", () => {
    const tree = expand(PluginGroup({
      plugin: "obsidian-brain",
      skills: [makeSkill("obsidian-brain", "lint"), makeSkill("obsidian-brain", "query")],
      selectedKey: null,
      onSelect: vi.fn(),
    }));
    const text = collectText(tree);
    expect(text).toContain("obsidian-brain");
    expect(text).toContain("lint");
    expect(text).toContain("query");
  });

  it("renders a per-plugin count badge", () => {
    const tree = expand(PluginGroup({
      plugin: "obsidian-brain",
      skills: [makeSkill("obsidian-brain", "a"), makeSkill("obsidian-brain", "b"), makeSkill("obsidian-brain", "c")],
      selectedKey: null,
      onSelect: vi.fn(),
    }));
    expect(collectText(tree)).toMatch(/\(?3\)?/);
  });

  // 0802: per-plugin caption renders the friendly tool name (e.g. "Claude Code")
  // under the uppercased folder header, matching project/personal symmetry.
  it("renders the pluginDisplay caption when the first skill provides it", () => {
    const tree = expand(PluginGroup({
      plugin: ".claude",
      skills: [
        makeSkill(".claude", "alpha", "installed", "Claude Code"),
        makeSkill(".claude", "beta", "installed", "Claude Code"),
      ],
      selectedKey: null,
      onSelect: vi.fn(),
    }));
    expect(collectText(tree)).toContain("Claude Code");
  });

  it("omits the caption when no pluginDisplay is supplied", () => {
    const tree = expand(PluginGroup({
      plugin: "obsidian-brain",
      skills: [makeSkill("obsidian-brain", "lint")],
      selectedKey: null,
      onSelect: vi.fn(),
    }));
    // No agent-display caption should be present for unknown plugin folders.
    expect(collectText(tree)).not.toContain("Claude Code");
    expect(collectText(tree)).not.toContain("Cursor");
  });

  it("alpha-sorts skills inside a group", () => {
    const tree = expand(PluginGroup({
      plugin: "obsidian-brain",
      skills: [
        makeSkill("obsidian-brain", "zeta"),
        makeSkill("obsidian-brain", "alpha"),
        makeSkill("obsidian-brain", "mu"),
      ],
      selectedKey: null,
      onSelect: vi.fn(),
    }));
    const text = collectText(tree);
    // order within the text should be alpha, mu, zeta
    const ia = text.indexOf("alpha");
    const im = text.indexOf("mu");
    const iz = text.indexOf("zeta");
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(im).toBeGreaterThan(ia);
    expect(iz).toBeGreaterThan(im);
  });
});
