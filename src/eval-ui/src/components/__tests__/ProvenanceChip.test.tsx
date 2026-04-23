import { describe, it, expect } from "vitest";
import { ProvenanceChip } from "../ProvenanceChip";

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

describe("ProvenanceChip", () => {
  it("extracts the leading agent directory segment (.claude) for display", () => {
    const tree = expand(ProvenanceChip({
      dir: "/home/user/.claude/skills/foo",
      root: "/home/user",
    }));
    const text = collectText(tree);
    expect(text).toContain(".claude");
  });

  it("handles relative paths (no leading root prefix)", () => {
    const tree = expand(ProvenanceChip({
      dir: ".cursor/skills/bar",
      root: ".",
    }));
    const text = collectText(tree);
    expect(text).toContain(".cursor");
  });

  it("falls back to the dir itself when no leading agent segment is found", () => {
    const tree = expand(ProvenanceChip({
      dir: "src/plugins/my-skill",
      root: "/project",
    })) as ReactEl;
    // Should render something (fallback), not crash
    expect(tree).toBeTruthy();
  });

  it("includes the full dir as a title tooltip", () => {
    const tree = ProvenanceChip({
      dir: "/home/user/.claude/skills/foo",
      root: "/home/user",
    }) as ReactEl;
    // Walk until we find any element with a title attribute
    const findTitle = (n: unknown): string | null => {
      if (!n || typeof n !== "object") return null;
      if (Array.isArray(n)) {
        for (const c of n) { const r = findTitle(c); if (r) return r; }
        return null;
      }
      const el = n as ReactEl;
      if (typeof el.props?.title === "string") return el.props.title;
      return findTitle(el.props?.children);
    };
    const t = findTitle(tree);
    expect(t).toBe("/home/user/.claude/skills/foo");
  });
});
