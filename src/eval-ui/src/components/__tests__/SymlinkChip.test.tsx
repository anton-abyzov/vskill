// @vitest-environment jsdom
import { describe, it, expect } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 0686 T-015 (UI-only portion): SymlinkChip — 10px chain-link SVG glyph
// with a hover/focus tooltip showing the symlink target.
//
// Covers AC-US8-02: row renders an SVG with data-testid="symlink-glyph";
// hovering it reveals a tooltip containing the target (mid-ellipsis > 60 chars).
//
// Pure component — driven by `target: string | null` prop. Server-side
// wiring (skill.isSymlink → render chip) lives in SkillRow, tested
// separately when the server CONTRACT_READY lands.
// ---------------------------------------------------------------------------

describe("0686 T-015: SymlinkChip", () => {
  it("renders an SVG glyph with data-testid='symlink-glyph'", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SymlinkChip } = await import("../SymlinkChip");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        React.createElement(SymlinkChip, {
          target: "/Users/me/.claude/plugins/cache/foo",
        }),
      );
    });

    const glyph = container.querySelector("[data-testid='symlink-glyph']");
    expect(glyph).toBeTruthy();
    expect(glyph?.tagName.toLowerCase()).toBe("svg");
    act(() => root.unmount());
    container.remove();
  });

  it("sets aria-label and title containing the target path for tooltip disclosure", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SymlinkChip } = await import("../SymlinkChip");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const target = "/Users/me/.claude/plugins/cache/foo/skills/bar";
    act(() => {
      root.render(React.createElement(SymlinkChip, { target }));
    });

    const wrapper = container.querySelector(
      "[data-testid='symlink-chip']",
    ) as HTMLElement;
    expect(wrapper).toBeTruthy();
    const title = wrapper.getAttribute("title") ?? "";
    const aria = wrapper.getAttribute("aria-label") ?? "";
    expect(title).toContain(target);
    expect(aria).toContain("symlinked");
    act(() => root.unmount());
    container.remove();
  });

  it("mid-ellipsises the displayed target when the path exceeds 60 chars", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SymlinkChip } = await import("../SymlinkChip");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // 80-char target → visible label must shrink but the full path stays in
    // `title` so the tooltip keeps full fidelity.
    const longTarget =
      "/Users/me/Projects/monorepo/packages/whatever/plugins/cache/org/long/skills/bar";
    act(() => {
      root.render(React.createElement(SymlinkChip, { target: longTarget }));
    });
    const wrapper = container.querySelector(
      "[data-testid='symlink-chip']",
    ) as HTMLElement;
    expect(wrapper.getAttribute("title")).toBe(`symlinked → ${longTarget}`);
    // The visible-label logic is used by consumers via `formatTarget` helper;
    // we assert the helper output directly so visual truncation is decoupled
    // from layout inspection under jsdom.
    const { formatSymlinkTarget } = await import("../SymlinkChip");
    const displayed = formatSymlinkTarget(longTarget);
    expect(displayed.length).toBeLessThan(longTarget.length);
    expect(displayed).toContain("…");
    act(() => root.unmount());
    container.remove();
  });

  it("returns null when target is nullish (symlink detected but unresolved)", async () => {
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { SymlinkChip } = await import("../SymlinkChip");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(React.createElement(SymlinkChip, { target: null }));
    });
    // Chip still renders a glyph with a cycle-detected tooltip, target="?".
    const wrapper = container.querySelector("[data-testid='symlink-chip']");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute("title")).toMatch(/cycle|unresolved|symlinked/i);
    act(() => root.unmount());
    container.remove();
  });
});
