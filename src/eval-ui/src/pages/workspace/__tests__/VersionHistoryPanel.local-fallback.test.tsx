// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// VersionHistoryPanel — local-version fallback when the platform returns
// `source: "none"` (or an empty list) but the on-disk SkillInfo carries a
// frontmatter version.
//
// Today, an installed skill with a `metadata.version: 0.1.0` SKILL.md but no
// upstream registry entry on verified-skill.com renders "No version history
// available" — even though the skill clearly has a known on-disk version.
// We want a single "local-only · v0.1.0 · installed" pseudo-entry instead, so
// the tab tells a coherent story with the header / sidebar badges.
//
// Source-origin skills keep the "Submit on verified-skill.com" CTA path —
// that empty state is the one with the explicit publish flow.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { SkillInfo } from "../../../types";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => [init, () => {}],
    useEffect: () => {},
    useRef: (init: unknown) => ({ current: init }),
    useCallback: <T,>(fn: T) => fn,
    useMemo: <T,>(fn: () => T) => fn(),
    useReducer: (_r: unknown, init: unknown) => [init, () => {}],
  };
});

let swrReturn: { data: unknown; loading: boolean } = { data: [], loading: false };
vi.mock("../../../hooks/useSWR", () => ({
  useSWR: () => swrReturn,
  mutate: vi.fn(),
}));

vi.mock("../../../api", () => ({
  api: {
    getSkillVersions: vi.fn(async () => []),
    getVersionDiff: vi.fn(),
    startSkillUpdate: vi.fn(),
    postSkillUpdate: vi.fn(),
  },
}));

let workspaceState: { plugin: string; skill: string } = { plugin: "claude-code", skill: "gws" };
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({ state: workspaceState }),
}));

let studioSkills: SkillInfo[] = [];
vi.mock("../../../StudioContext", () => ({
  useStudio: () => ({
    state: { skills: studioSkills },
    refreshSkills: vi.fn(),
    updateCount: 0,
  }),
}));

vi.mock("../../../components/ChangelogViewer", () => ({
  ChangelogViewer: () => null,
}));

import { VersionHistoryPanel } from "../VersionHistoryPanel";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findElements(el.props.children, match));
  return out;
}

function findByTestId(tree: unknown, id: string): ReactEl[] {
  return findElements(tree, (el) => {
    const p = el.props as Record<string, unknown>;
    return p["data-testid"] === id;
  });
}

function collectText(node: unknown): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object") {
    const el = node as ReactEl;
    return collectText(el.props?.children);
  }
  return "";
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "claude-code",
    skill: "gws",
    dir: "/Users/anton/.claude/skills/gws",
    hasEvals: false,
    hasBenchmark: false,
    evalCount: 0,
    assertionCount: 0,
    benchmarkStatus: "pending",
    lastBenchmark: null,
    origin: "installed",
    description: null,
    version: "0.1.0",
    category: null,
    author: null,
    license: null,
    homepage: null,
    tags: null,
    deps: null,
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: null,
    sizeBytes: null,
    sourceAgent: null,
    ...over,
  };
}

describe("VersionHistoryPanel — local-version fallback", () => {
  it("installed skill + empty platform list + frontmatter version → renders a local-only pseudo-entry", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "claude-code", skill: "gws" };
    studioSkills = [makeSkill({ origin: "installed", version: "0.1.0" })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const localRow = findByTestId(tree, "version-row-local");
    expect(localRow.length).toBe(1);
    const text = collectText(localRow[0]);
    expect(text).toContain("0.1.0");
    expect(text.toLowerCase()).toContain("local");

    // The bare legacy empty state must NOT render alongside the local row.
    expect(findByTestId(tree, "versions-empty-state-installed").length).toBe(0);
  });

  it("installed skill + empty platform list + NO frontmatter version → keeps the legacy bare empty state", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "claude-code", skill: "tax-filing" };
    studioSkills = [makeSkill({ skill: "tax-filing", origin: "installed", version: null })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    expect(findByTestId(tree, "version-row-local").length).toBe(0);
    expect(findByTestId(tree, "versions-empty-state-installed").length).toBe(1);
  });

  it("source skill + empty platform list + frontmatter version → submit CTA still wins (no local pseudo-row)", () => {
    swrReturn = { data: [], loading: false };
    workspaceState = { plugin: "vskill", skill: "greet-anton" };
    studioSkills = [makeSkill({ plugin: "vskill", skill: "greet-anton", origin: "source", version: "1.0.1" })];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    expect(findByTestId(tree, "versions-empty-state-cta").length).toBe(1);
    expect(findByTestId(tree, "version-row-local").length).toBe(0);
  });
});
