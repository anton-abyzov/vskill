// ---------------------------------------------------------------------------
// T-008 (0707): DetailHeader integrates VersionBadge + AuthorLink +
// SourceFileLink in its sticky header row.
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
    plugin: "easychamp",
    skill: "tournament-manager",
    dir: "/Users/test/plugins/easychamp/skills/tournament-manager",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 3,
    assertionCount: 9,
    benchmarkStatus: "pass",
    lastBenchmark: null,
    origin: "source",
    version: "0.1.0",
    author: "Anton Abyzov",
    homepage: "https://github.com/anton-abyzov/easychamp-mcp",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    ...over,
  };
}

describe("DetailHeader — T-008 byline + version badge integration", () => {
  it("renders VersionBadge inside the detail-header-version slot (no plain-text version)", () => {
    const tree = DetailHeader({ skill: makeSkill() });
    const badge = findAll(tree, (el) => el.props?.["data-testid"] === "version-badge");
    expect(badge.length).toBeGreaterThanOrEqual(1);
    // Badge shows "v0.1.0"
    expect(collectText(badge[0])).toContain("v0.1.0");
  });

  it("renders the byline row with AuthorLink + SourceFileLink", () => {
    const tree = DetailHeader({ skill: makeSkill() });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    expect(byline).toBeDefined();
    // AuthorLink is an anchor (repoUrl parses to github.com/anton-abyzov).
    const anchor = findAll(byline, (el) => el.type === "a" && typeof el.props?.href === "string");
    expect(anchor.length).toBeGreaterThanOrEqual(1);
    expect(String(anchor[0].props.href)).toBe("https://github.com/anton-abyzov");
    // SourceFileLink renders with ↗ affordance (since repoUrl parses).
    expect(collectText(byline)).toContain("Anton Abyzov");
    expect(collectText(byline)).toContain("↗");
  });

  it("falls back to copy-chips when the skill has no homepage / repo URL", () => {
    const tree = DetailHeader({ skill: makeSkill({ homepage: null }) });
    const byline = findAll(tree, (el) => el.props?.["data-testid"] === "detail-header-byline")[0];
    // AuthorLink becomes a button (copy chip) when no repoUrl.
    const buttons = findAll(byline, (el) => el.type === "button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
