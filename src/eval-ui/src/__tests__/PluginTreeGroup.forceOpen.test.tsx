// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0704: PluginTreeGroup `forceOpen` — overrides collapsed state (both the
// initialCollapsed prop and any persisted localStorage value) without
// mutating the underlying state, so the user's preference is restored once
// forceOpen goes false again.
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

describe("PluginTreeGroup — forceOpen (0704)", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch {}
  });

  it("renders children when forceOpen=true overrides initialCollapsed=true", () => {
    const skills = [fakeSkill("anthropic-skills", "pdf")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        initialCollapsed
        forceOpen
        renderSkill={(s) => <span data-test="child">{s.skill}</span>}
      />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("vskill-plugin-tree-children");
    expect(html).toContain('data-test="child"');
  });

  it("renders children when forceOpen=true even with persisted collapsed state", () => {
    window.localStorage.setItem("vskill-plugin-tree-forceopen-key-collapsed", "true");
    const skills = [fakeSkill("sw", "increment")];
    const html = renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        persistKey="vskill-plugin-tree-forceopen-key-collapsed"
        forceOpen
        renderSkill={(s) => <span data-test="child">{s.skill}</span>}
      />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("vskill-plugin-tree-children");
    // underlying preference untouched
    expect(window.localStorage.getItem("vskill-plugin-tree-forceopen-key-collapsed")).toBe("true");
  });

  it("forceOpen=true does not write to localStorage on mount", () => {
    const key = "vskill-plugin-tree-forceopen-no-write";
    const skills = [fakeSkill("sw", "do")];
    renderToStaticMarkup(
      <PluginTreeGroup
        skills={skills}
        persistKey={key}
        forceOpen
        renderSkill={(s) => <span>{s.skill}</span>}
      />,
    );
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
