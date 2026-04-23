import { describe, it, expect, vi } from "vitest";
import { SkillRowInner } from "../SkillRow";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/** Expand function components into their rendered output. */
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

function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

function baseSkill(overrides: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian-brain",
    skill: "lint",
    dir: "/tmp",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    scope: "installed",
    installMethod: "copied",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 0686 T-015 (US-008): SkillRow symlink integration.
//
// SymlinkChip has its own dedicated unit tests (SymlinkChip.test.tsx) that
// cover the chip's rendering contract in isolation. This suite verifies the
// integration seam: SkillRow renders the chip ONLY when the SkillInfo
// payload carries `isSymlink === true`, preserves backward-compat with
// legacy payloads that lack the flag, and passes the target through so
// the chip's tooltip gets the real path.
//
// Covers:
//   AC-US8-02  Symlink row displays chain-link glyph with hoverable target.
//   AC-US8-03  Copied rows render no chip (install-method is authored /
//              copied and the chip stays out of the way).
//   AC-US8-04  When target is `null` (cycle detected), the row still
//              mounts the chip (SymlinkChip handles the unresolved
//              fallback tooltip).
// ---------------------------------------------------------------------------

describe("0686 T-015: SkillRow symlink integration", () => {
  it("renders the symlink chip when skill.isSymlink === true", () => {
    const tree = expand(
      SkillRowInner({
        skill: baseSkill({
          isSymlink: true,
          symlinkTarget:
            "/Users/me/.claude/plugins/cache/foo/skills/bar",
          installMethod: "symlinked",
        }),
        isSelected: false,
        onSelect: vi.fn(),
      }),
    );
    const chips = findElements(
      tree,
      (el) => el.props?.["data-testid"] === "symlink-chip",
    );
    expect(chips).toHaveLength(1);
    // The chip must carry the target path in the title attribute so the
    // browser tooltip surfaces it on hover.
    const title = (chips[0].props.title as string) ?? "";
    expect(title).toContain(
      "/Users/me/.claude/plugins/cache/foo/skills/bar",
    );
  });

  it("renders NO symlink chip on copied (non-symlink) skills", () => {
    const tree = expand(
      SkillRowInner({
        skill: baseSkill({
          isSymlink: false,
          symlinkTarget: null,
          installMethod: "copied",
        }),
        isSelected: false,
        onSelect: vi.fn(),
      }),
    );
    const chips = findElements(
      tree,
      (el) => el.props?.["data-testid"] === "symlink-chip",
    );
    expect(chips).toHaveLength(0);
  });

  it("renders no chip on legacy payloads where isSymlink is undefined", () => {
    const legacy: SkillInfo = {
      plugin: "obsidian-brain",
      skill: "ingest",
      dir: "/tmp",
      hasEvals: false,
      hasBenchmark: false,
      evalCount: 0,
      assertionCount: 0,
      benchmarkStatus: "missing",
      lastBenchmark: null,
      origin: "installed",
      // isSymlink / symlinkTarget / installMethod intentionally omitted —
      // simulates a pre-0686 server payload.
    };
    const tree = expand(
      SkillRowInner({
        skill: legacy,
        isSelected: false,
        onSelect: vi.fn(),
      }),
    );
    const chips = findElements(
      tree,
      (el) => el.props?.["data-testid"] === "symlink-chip",
    );
    expect(chips).toHaveLength(0);
  });

  it("still mounts the chip when symlinkTarget is null (cycle detected)", () => {
    const tree = expand(
      SkillRowInner({
        skill: baseSkill({
          isSymlink: true,
          symlinkTarget: null,
          installMethod: "symlinked",
        }),
        isSelected: false,
        onSelect: vi.fn(),
      }),
    );
    const chips = findElements(
      tree,
      (el) => el.props?.["data-testid"] === "symlink-chip",
    );
    expect(chips).toHaveLength(1);
    const title = (chips[0].props.title as string) ?? "";
    // Unresolved cases fall back to a cycle-detected tooltip.
    expect(title).toMatch(/cycle|unresolved|symlinked/i);
  });
});
