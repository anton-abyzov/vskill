// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0698 T-010: PluginTreeGroup — collapsible per-plugin subtree.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PluginTreeGroup } from "../components/PluginTreeGroup";
import type { SkillInfo } from "../types";

function fakeSkill(plugin: string, skill: string): SkillInfo {
  return {
    plugin,
    skill,
    dir: `/fake/${plugin}/${skill}`,
    hasEvals: false,
    hasBenchmark: false,
    origin: "installed",
    scopeV2: "available-plugin",
    group: "available",
    source: "plugin",
    pluginName: plugin,
    pluginNamespace: `${plugin}:${skill}`,
    benchmarkStatus: "missing",
    lastBenchmark: null,
  } as unknown as SkillInfo;
}

describe("PluginTreeGroup (0698 T-010)", () => {
  beforeEach(() => {
    // Clear any localStorage from prior runs
    try {
      window.localStorage.clear();
    } catch {}
  });

  it("renders the plugin name as a button with skill count and collapse chevron", () => {
    const skills = [fakeSkill("anthropic-skills", "pdf"), fakeSkill("anthropic-skills", "docx")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        renderSkill={(s) => <span>{s.pluginNamespace}</span>}
      />,
    );
    expect(html).toContain("anthropic-skills");
    expect(html).toContain("(2)");
    // Chevron + button role present (collapsible)
    expect(html).toContain("<button");
    expect(html).toContain('aria-expanded="true"');
    // Namespace rendered in mono
    expect(html).toContain("anthropic-skills:pdf");
    expect(html).toContain("anthropic-skills:docx");
  });

  it("hides child skills when initialCollapsed=true", () => {
    const skills = [fakeSkill("sw", "increment")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        initialCollapsed
        renderSkill={(s) => <span data-test="skill">{s.skill}</span>}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    // Collapsed: skills container absent
    expect(html).not.toContain("vskill-plugin-tree-children");
    // Chevron is the collapsed glyph
    expect(html).toContain("▸");
  });

  it("uses font-mono for the plugin namespace (AC-US4-03 visual)", () => {
    const skills = [fakeSkill("sw", "do")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup skills={skills} renderSkill={(s) => <span className="font-mono">{s.pluginNamespace}</span>} />,
    );
    expect(html).toContain("font-mono");
    expect(html).toContain("sw:do");
  });

  it("reads initial collapse state from localStorage when persistKey is provided", () => {
    window.localStorage.setItem("vskill-plugin-tree-test-key-collapsed", "true");
    const skills = [fakeSkill("sw", "increment")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        persistKey="vskill-plugin-tree-test-key-collapsed"
        renderSkill={(s) => <span>{s.skill}</span>}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
  });

  it("uses pluginName prop when skills array has no pluginName on first entry", () => {
    const skills = [{ ...fakeSkill("fallback", "x"), pluginName: null }] as SkillInfo[];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        pluginName="explicit-plugin"
        renderSkill={(s) => <span>{s.skill}</span>}
      />,
    );
    expect(html).toContain("explicit-plugin");
  });

  it("matches snapshot for a typical AVAILABLE > Plugins subtree", () => {
    const skills = [
      fakeSkill("anthropic-skills", "docx"),
      fakeSkill("anthropic-skills", "pdf"),
    ];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        renderSkill={(s) => <span>{s.pluginNamespace}</span>}
      />,
    );
    expect(html).toMatchSnapshot();
  });
});
