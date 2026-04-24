// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0698 T-015: ProjectPicker component + ProjectCommandPalette (⌘P).
//
// Renders via react-dom/server (static markup) for structural assertions;
// uses fuzzyFilterProjects as a pure-unit test for the palette query logic.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPicker } from "../components/ProjectPicker";
import {
  ProjectCommandPalette,
  fuzzyFilterProjects,
} from "../components/ProjectCommandPalette";
import type { ProjectConfigRaw } from "../hooks/useWorkspace";

const p = (id: string, name: string, path: string, color = "oklch(0.72 0.13 10)"): ProjectConfigRaw => ({
  id,
  name,
  path,
  colorDot: color,
  addedAt: "2026-04-24T00:00:00Z",
});

describe("ProjectPicker (0698 T-015)", () => {
  it("shows the active project name in the pill", () => {
    const workspace = {
      activeProjectId: "abc",
      projects: [p("abc", "alpha", "/path/alpha"), p("def", "beta", "/path/beta")],
    };
    const html = renderToStaticMarkup(
      <ProjectPicker workspace={workspace} onSwitch={vi.fn()} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(html).toContain("alpha");
    expect(html).toContain("data-vskill-project-picker");
    // SSR output: aria-expanded defaults to false (collapsed)
    expect(html).toContain('aria-expanded="false"');
  });

  it("shows 'No project selected' when workspace is empty", () => {
    const html = renderToStaticMarkup(
      <ProjectPicker workspace={undefined} onSwitch={vi.fn()} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(html).toContain("No project selected");
  });

  it("uses the project's OKLCH colorDot on the pill indicator", () => {
    const workspace = {
      activeProjectId: "abc",
      projects: [p("abc", "alpha", "/path/alpha", "oklch(0.72 0.13 180)")],
    };
    const html = renderToStaticMarkup(
      <ProjectPicker workspace={workspace} onSwitch={vi.fn()} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(html).toContain("oklch(0.72 0.13 180)");
  });

  it("uses monospace font class on the pill (path-scale density)", () => {
    const workspace = {
      activeProjectId: "abc",
      projects: [p("abc", "alpha", "/p/a")],
    };
    const html = renderToStaticMarkup(
      <ProjectPicker workspace={workspace} onSwitch={vi.fn()} onAdd={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(html).toContain("font-mono");
  });
});

describe("fuzzyFilterProjects (0698 T-015)", () => {
  const projects = [
    p("1", "specweave-umb", "/Users/a/projects/specweave-umb"),
    p("2", "vskill", "/Users/a/projects/vskill"),
    p("3", "obsidian-vault", "/Users/a/projects/personal-docs"),
  ];

  it("returns all when query is empty", () => {
    expect(fuzzyFilterProjects(projects, "")).toHaveLength(3);
  });

  it("matches by name (case-insensitive)", () => {
    expect(fuzzyFilterProjects(projects, "VSKILL").map((x) => x.id)).toEqual(["2"]);
  });

  it("matches by path fragments", () => {
    expect(fuzzyFilterProjects(projects, "personal").map((x) => x.id)).toEqual(["3"]);
  });

  it("AND-combines multiple tokens", () => {
    expect(fuzzyFilterProjects(projects, "spec umb").map((x) => x.id)).toEqual(["1"]);
  });

  it("returns [] on no match", () => {
    expect(fuzzyFilterProjects(projects, "nonexistent-fragment")).toEqual([]);
  });
});

describe("ProjectCommandPalette (0698 T-015)", () => {
  it("returns null when open=false", () => {
    const html = renderToStaticMarkup(
      <ProjectCommandPalette open={false} projects={[]} onSwitch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toBe("");
  });

  it("renders dialog markup when open=true", () => {
    const projects = [p("1", "alpha", "/a")];
    const html = renderToStaticMarkup(
      <ProjectCommandPalette open projects={projects} onSwitch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("data-vskill-project-palette");
    expect(html).toContain("alpha");
    expect(html).toContain("/a");
  });

  it("renders 'No matches.' when projects list is empty", () => {
    const html = renderToStaticMarkup(
      <ProjectCommandPalette open projects={[]} onSwitch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(html).toContain("No matches");
  });
});
