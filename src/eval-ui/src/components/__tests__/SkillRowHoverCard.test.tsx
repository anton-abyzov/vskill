// ---------------------------------------------------------------------------
// T-032: SkillRowHoverCard — progressive-disclosure hover popover.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

// Mocked React hooks — useState returns the initial value so tests can
// inspect both the closed and the open states by flipping the default.
let forcedOpen = false;
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(init: T) => [forcedOpen && typeof init === "boolean" ? (true as unknown as T) : init, () => {}],
    useEffect: () => {},
    useRef: <T,>(init: T) => ({ current: init }),
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
  };
});

import { SkillRowHoverCard } from "../SkillRowHoverCard";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "p",
    skill: "s",
    dir: "/tmp/s",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 3,
    assertionCount: 6,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01",
    origin: "source",
    description: "A detailed skill description for the hovercard.",
    version: "1.0.0",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: ["a", "b", "c", "d", "e", "f"],
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 0,
    sourceAgent: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// When closed (default) — renders children and nothing else.
// ---------------------------------------------------------------------------
describe("T-032 SkillRowHoverCard — closed state", () => {
  it("renders children and no popover at rest", () => {
    forcedOpen = false;
    const tree = SkillRowHoverCard({
      skill: makeSkill(),
      children: "child-marker" as unknown as React.ReactNode,
    });
    const text = collectText(tree);
    expect(text).toContain("child-marker");
    const popovers = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "skill-row-hovercard";
    });
    expect(popovers.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// When opened — renders progressive-disclosure fields.
// ---------------------------------------------------------------------------
describe("T-032 SkillRowHoverCard — open state (forced)", () => {
  it("shows description, version, relative time, eval count, and capped tags", () => {
    forcedOpen = true;
    const tree = SkillRowHoverCard({
      skill: makeSkill(),
      children: "child-marker" as unknown as React.ReactNode,
    });
    const popovers = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "skill-row-hovercard";
    });
    expect(popovers.length).toBe(1);
    const text = collectText(popovers[0]);
    expect(text).toContain("A detailed skill description");
    expect(text).toContain("1.0.0");
    // Eval count surfaced as its raw number
    expect(text).toContain("3");
    // First 4 tags shown, then "+2" overflow indicator (6 total, 4 shown, 2 extra)
    expect(text).toContain("+2");
  });

  it("renders em-dash placeholders for missing fields", () => {
    forcedOpen = true;
    const tree = SkillRowHoverCard({
      skill: makeSkill({ description: null, version: null, tags: null, lastModified: null }),
      children: "child-marker" as unknown as React.ReactNode,
    });
    const popovers = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "skill-row-hovercard";
    });
    const text = collectText(popovers[0]);
    expect(text).toContain("—");
    // No "undefined" literal leaks in
    expect(text).not.toContain("undefined");
  });

  it("popover uses fade-in animation with 180ms var(--ease-standard)", () => {
    forcedOpen = true;
    const tree = SkillRowHoverCard({
      skill: makeSkill(),
      children: "child-marker" as unknown as React.ReactNode,
    });
    const popovers = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "skill-row-hovercard";
    });
    const style = popovers[0].props.style as Record<string, string>;
    expect(style.animation || "").toMatch(/180ms/);
    expect(style.animation || "").toContain("var(--ease-standard");
  });

  it("popover card is bg-surface / 1px border-default / no shadow", () => {
    forcedOpen = true;
    const tree = SkillRowHoverCard({
      skill: makeSkill(),
      children: "child-marker" as unknown as React.ReactNode,
    });
    const popovers = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "skill-row-hovercard";
    });
    const style = popovers[0].props.style as Record<string, string>;
    expect(style.background).toContain("--bg-surface");
    expect(style.border).toContain("--border-default");
    expect(style.boxShadow ?? "none").toBe("none");
  });
});
