// ---------------------------------------------------------------------------
// T-026: DetailHeader typography + path chip + dot-only origin badges
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

// React is called directly — mock hooks to no-ops so the component function
// can be invoked like a pure function returning a React element tree.
vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
}));

import { DetailHeader } from "../DetailHeader";
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
    plugin: "obsidian",
    skill: "obsidian-brain",
    dir: "/Users/test/.claude/skills/obsidian-brain",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 3,
    assertionCount: 12,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01T12:00:00Z",
    origin: "source",
    description: null,
    version: "1.3.0",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    sourceAgent: null,
    ...over,
  };
}

describe("T-026 DetailHeader — redesigned header", () => {
  it("renders skill name using serif font-family token", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill });

    // Skill name element uses --font-serif (only allowed serif surface in Phase 3)
    const serifEls = findAll(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && typeof style.fontFamily === "string" && style.fontFamily.includes("--font-serif");
    });
    expect(serifEls.length).toBeGreaterThan(0);
    const anyHasName = serifEls.some((el) => collectText(el).includes("obsidian-brain"));
    expect(anyHasName).toBe(true);
  });

  it("renders plugin breadcrumb prefix separate from skill name", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill });
    const text = collectText(tree);
    expect(text).toContain("obsidian");
    expect(text).toContain("obsidian-brain");
  });

  it("renders a dot-only origin badge (no pill fill) for source skills", () => {
    const skill = makeSkill({ origin: "source" });
    const tree = DetailHeader({ skill });
    const dots = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-origin-dot"] === "source";
    });
    expect(dots.length).toBe(1);
    const style = dots[0].props?.style as Record<string, string>;
    // Dot uses status-own token, has no background fill beyond the dot itself
    expect(style.background).toContain("--status-own");
  });

  it("renders a dot-only installed badge for installed skills", () => {
    const skill = makeSkill({ origin: "installed" });
    const tree = DetailHeader({ skill });
    const dots = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-origin-dot"] === "installed";
    });
    expect(dots.length).toBe(1);
    const style = dots[0].props?.style as Record<string, string>;
    expect(style.background).toContain("--status-installed");
  });

  it("renders the truncated path chip with copy-to-clipboard button", () => {
    const skill = makeSkill({ dir: "/Users/test/.claude/skills/obsidian-brain" });
    const tree = DetailHeader({ skill });

    // Path chip element
    const pathEls = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-path-chip";
    });
    expect(pathEls.length).toBe(1);

    // Copy button
    const copyBtns = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-testid"] === "detail-header-copy-path";
    });
    expect(copyBtns.length).toBe(1);
  });

  it("renders version using tabular numbers (now via VersionBadge — 0707 T-008)", () => {
    const skill = makeSkill({ version: "1.3.0" });
    const tree = DetailHeader({ skill });
    // The VersionBadge appears as a function-component element whose props
    // carry the raw version. Verify the version slot wraps a VersionBadge
    // call (which internally applies `font-variant-numeric: tabular-nums`).
    const versionSlot = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-version")[0];
    expect(versionSlot).toBeDefined();
    const badgeCandidates = findAll(versionSlot, (el) => {
      if (typeof el.type !== "function") return false;
      const name = (el.type as { name?: string }).name ?? "";
      return name === "VersionBadge";
    });
    expect(badgeCandidates.length).toBe(1);
    expect((badgeCandidates[0].props as { version?: string }).version).toBe("1.3.0");
  });

  it("hides the version slot entirely when no version is declared (0707 T-008)", () => {
    const skill = makeSkill({ version: null });
    const tree = DetailHeader({ skill });
    // The detail-header-version <span> is still present but VersionBadge
    // renders null when version is missing — so no "v…" text leaks into
    // the header, and the plain em-dash is no longer required.
    const versionSlot = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-version")[0];
    expect(versionSlot).toBeDefined();
    const text = collectText(versionSlot);
    expect(text).not.toMatch(/v\d/);
  });

  it("uses bg-surface background and 1px border-default border (no shadow)", () => {
    const skill = makeSkill();
    const tree = DetailHeader({ skill });
    // The outer card root has these properties
    const el = tree as ReactEl;
    const style = el.props?.style as Record<string, string> | undefined;
    expect(style?.background).toContain("--bg-surface");
    expect(style?.border).toContain("--border-default");
    // no box-shadow at top level
    expect(style?.boxShadow ?? "none").toBe("none");
  });
});
