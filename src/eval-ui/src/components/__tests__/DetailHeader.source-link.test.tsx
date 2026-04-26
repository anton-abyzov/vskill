// ---------------------------------------------------------------------------
// 0737 RED: DetailHeader byline source-file anchor.
//
// AC-US1-01 / AC-US1-02 / AC-US2-01 — when SkillInfo carries `repoUrl` AND
// `skillPath` (populated by buildSkillMetadata after this change), the
// byline must render a source-file anchor pointing to the SKILL.md blob URL
// on GitHub, not to the repo root. This is the visible parity gap with
// verified-skill.com.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { DetailHeader } from "../DetailHeader";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      out.push(...findAll(rendered, match));
    } catch { /* ignore */ }
  }
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      return collectText(rendered);
    } catch { return ""; }
  }
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "marketingskills",
    skill: "analytics-tracking",
    dir: "/Users/test/.claude/skills/marketingskills/analytics-tracking",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "missing",
    lastBenchmark: null,
    origin: "installed",
    version: "1.0.0",
    author: "Corey Haines",
    repoUrl: "https://github.com/coreyhaines31/marketingskills",
    skillPath: "skills/analytics-tracking/SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    ...over,
  };
}

describe("0737: DetailHeader byline renders source-file anchor", () => {
  it("renders an anchor whose href targets the SKILL.md blob URL when repoUrl + skillPath are present", () => {
    const tree = DetailHeader({ skill: makeSkill() });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    expect(byline).toBeDefined();

    const sourceLink = findAll(byline, (el) => el.props?.["data-testid"] === "source-file-link")[0];
    expect(sourceLink).toBeDefined();
    expect(sourceLink.type).toBe("a");
    expect(String(sourceLink.props.href)).toBe(
      "https://github.com/coreyhaines31/marketingskills/blob/HEAD/skills/analytics-tracking/SKILL.md",
    );
    expect(sourceLink.props.target).toBe("_blank");
    expect(sourceLink.props.rel).toBe("noopener noreferrer");
  });

  it("anchor label is the last skillPath segment + ↗ marker", () => {
    const tree = DetailHeader({ skill: makeSkill() });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    const sourceLink = findAll(byline, (el) => el.props?.["data-testid"] === "source-file-link")[0];
    const label = collectText(sourceLink);
    expect(label).toContain("SKILL.md");
    expect(label).toContain("↗");
  });

  it("AuthorLink renders alongside SourceFileLink — both anchors visible (US-002)", () => {
    // AuthorLink contract: anchor → publisher PROFILE (github.com/{owner}),
    // not the repo root. The SourceFileLink anchor (US-001) covers the
    // path-back-to-source need by landing on the SKILL.md blob page; from
    // there the user is one click away from the repo root. We assert here
    // that BOTH anchors coexist in the byline (no truncation collapse).
    const tree = DetailHeader({ skill: makeSkill() });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    const anchors = findAll(byline, (el) => el.type === "a" && typeof el.props?.href === "string");
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    // First anchor: publisher profile derived from repoUrl.
    expect(String(anchors[0].props.href)).toBe("https://github.com/coreyhaines31");
    // Second anchor: SKILL.md blob URL.
    expect(String(anchors[1].props.href)).toBe(
      "https://github.com/coreyhaines31/marketingskills/blob/HEAD/skills/analytics-tracking/SKILL.md",
    );
  });

  it("falls back to source-file copy-chip when repoUrl is null (US-003)", () => {
    const tree = DetailHeader({
      skill: makeSkill({ repoUrl: null, homepage: null, skillPath: null }),
    });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    const copyChip = findAll(byline, (el) => el.props?.["data-testid"] === "source-file-copy");
    // No source-file-link anchor.
    const sourceLink = findAll(byline, (el) => el.props?.["data-testid"] === "source-file-link");
    expect(sourceLink.length).toBe(0);
    expect(copyChip.length).toBe(1);
  });

  it("uses frontmatter `homepage` when `repoUrl` is null but homepage is a github URL (regression — pre-0737 path)", () => {
    const tree = DetailHeader({
      skill: makeSkill({
        repoUrl: null,
        skillPath: null,
        homepage: "https://github.com/anton-abyzov/easychamp-mcp",
      }),
    });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    const sourceLink = findAll(byline, (el) => el.props?.["data-testid"] === "source-file-link")[0];
    expect(sourceLink).toBeDefined();
    expect(String(sourceLink.props.href)).toBe(
      "https://github.com/anton-abyzov/easychamp-mcp/blob/HEAD/",
    );
  });
});
