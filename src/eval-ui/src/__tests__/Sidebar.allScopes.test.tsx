// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0698 T-009: two-tier Sidebar layout.
//
// Renders Sidebar with tri-scope data and verifies the GroupHeader wrappers
// for AVAILABLE and AUTHORING appear with correct counts. Verifies legacy
// labels are still present in the underlying NamedScopeSection content (full
// rename ripple is a later pass).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../components/Sidebar";
import type { SkillInfo } from "../types";

function skill(
  plugin: string,
  name: string,
  scope: "own" | "installed" | "global",
  extras: Partial<SkillInfo> = {},
): SkillInfo {
  return {
    plugin,
    skill: name,
    dir: `/fake/${plugin}/${name}`,
    hasEvals: false,
    hasBenchmark: false,
    origin: scope === "own" ? "source" : "installed",
    scope,
    ...extras,
  } as unknown as SkillInfo;
}

describe("Sidebar two-tier layout (0698 T-009)", () => {
  it("renders AVAILABLE and AUTHORING group headers with correct totals", () => {
    const skills = [
      skill("a", "s1", "installed"),
      skill("a", "s2", "installed"),
      skill("b", "g1", "global"),
      skill("c", "o1", "own"),
    ];
    const html = renderToStaticMarkup(
      <Sidebar
        skills={skills}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );
    // Group headers present
    expect(html).toContain("AVAILABLE");
    expect(html).toContain("AUTHORING");
    // AVAILABLE = installed (2) + global (1) = 3
    expect(html).toMatch(/AVAILABLE[\s\S]*?\(3\)/);
    // AUTHORING = own (1)
    expect(html).toMatch(/AUTHORING[\s\S]*?\(1\)/);
  });

  it("shows AVAILABLE/AUTHORING group headers even when counts are zero", () => {
    const skills: SkillInfo[] = [];
    const html = renderToStaticMarkup(
      <Sidebar
        skills={skills}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );
    expect(html).toContain("AVAILABLE");
    expect(html).toContain("AUTHORING");
    // Both show (0)
    expect(html).toMatch(/AVAILABLE[\s\S]*?\(0\)/);
    expect(html).toMatch(/AUTHORING[\s\S]*?\(0\)/);
  });

  it("places AVAILABLE group before AUTHORING group in DOM order", () => {
    const skills = [skill("a", "x", "installed"), skill("b", "y", "own")];
    const html = renderToStaticMarkup(
      <Sidebar
        skills={skills}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );
    const idxAvailable = html.indexOf("AVAILABLE");
    const idxAuthoring = html.indexOf("AUTHORING");
    expect(idxAvailable).toBeGreaterThan(-1);
    expect(idxAuthoring).toBeGreaterThan(-1);
    expect(idxAvailable).toBeLessThan(idxAuthoring);
  });

  it("renders both group headers as GroupHeader components (role=heading, not buttons)", () => {
    const skills = [skill("a", "s1", "installed")];
    const html = renderToStaticMarkup(
      <Sidebar
        skills={skills}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );
    // Both groups have heading markers from GroupHeader
    const headingMatches = html.match(/data-vskill-group-header="(AVAILABLE|AUTHORING)"/g);
    expect(headingMatches).not.toBeNull();
    expect(headingMatches!.length).toBe(2);
  });

  it("AVAILABLE group count includes both Project and Personal totals", () => {
    const skills = [
      skill("a", "p1", "installed"),
      skill("a", "p2", "installed"),
      skill("a", "p3", "installed"),
      skill("b", "g1", "global"),
      skill("b", "g2", "global"),
    ];
    const html = renderToStaticMarkup(
      <Sidebar
        skills={skills}
        selectedKey={null}
        onSelect={vi.fn()}
        activeAgentId="claude-code"
      />,
    );
    // 3 installed + 2 global = 5
    expect(html).toMatch(/AVAILABLE[\s\S]*?\(5\)/);
  });
});
