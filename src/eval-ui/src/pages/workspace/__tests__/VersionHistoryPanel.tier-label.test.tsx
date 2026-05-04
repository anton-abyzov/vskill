// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// 0761 US-002: VersionHistoryPanel renders trust-tier labels (e.g. "Trusted
// Publisher") rather than the raw `certTier` enum (e.g. "CERTIFIED"), to match
// the rest of the studio's nomenclature (TierBadge.tsx).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { SkillInfo, VersionEntry } from "../../../types";

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
    getSkillVersionsEnvelope: vi.fn(async () => ({
      versions: [],
      count: 0,
      source: "platform",
      provider: "vskill",
      trackedForUpdates: false,
    })),
    getVersionDiff: vi.fn(),
    startSkillUpdate: vi.fn(),
    postSkillUpdate: vi.fn(),
  },
}));

let workspaceState: { plugin: string; skill: string } = {
  plugin: "vskill",
  skill: "greet-anton",
};
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
  // 0823 F-007: also descend into function components so chip-walks reach
  // the inner span emitted by `<ProviderChip />`.
  if (typeof el.type === "function") {
    try {
      const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
      out.push(...findElements(rendered, match));
    } catch {
      /* ignore */
    }
  }
  if (el.props?.children != null) out.push(...findElements(el.props.children, match));
  return out;
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

function makeVersion(over: Partial<VersionEntry> = {}): VersionEntry {
  return {
    version: "1.0.1",
    certTier: "CERTIFIED",
    certScore: 90,
    diffSummary: null,
    createdAt: "2026-04-26T05:52:18.073Z",
    isInstalled: true,
    contentHash: "abc",
    gitSha: "def",
    ...over,
  } as VersionEntry;
}

describe("VersionHistoryPanel — provider chip per row (0823 F-007 / AC-US2-09)", () => {
  it("AC-US2-09: provider chip renders for each version row", () => {
    swrReturn = {
      data: {
        versions: [
          makeVersion({ certTier: "CERTIFIED", version: "1.0.1" }),
          makeVersion({ certTier: "VERIFIED", version: "1.0.0" }),
        ],
        count: 2,
        source: "platform",
        provider: "anthropic",
        trackedForUpdates: true,
      },
      loading: false,
    };
    studioSkills = [];
    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    // Two version rows × one ProviderChip each = at least two chip elements.
    const chips = findElements(tree, (el) => {
      const props = el.props as Record<string, unknown> | undefined;
      const tid = props?.["data-testid"];
      return typeof tid === "string" && tid.startsWith("provider-chip-");
    });
    expect(chips.length).toBeGreaterThanOrEqual(2);
    chips.forEach((c) => {
      expect((c.props as Record<string, unknown>)["data-provider"]).toBe("anthropic");
    });
  });
});

describe("VersionHistoryPanel — tier label nomenclature (0761 US-002)", () => {
  it("AC-US2-01: CERTIFIED renders as 'Trusted Publisher'", () => {
    // 0823: VersionHistoryPanel now reads the envelope variant — wrap the
    // legacy array in { versions, source, provider, trackedForUpdates }.
    swrReturn = {
      data: {
        versions: [makeVersion({ certTier: "CERTIFIED" })],
        count: 1,
        source: "platform",
        provider: "vskill",
        trackedForUpdates: true,
      },
      loading: false,
    };
    studioSkills = [];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const text = collectText(tree);

    expect(text).toContain("Trusted Publisher");
    expect(text).not.toContain("CERTIFIED");
  });

  it("AC-US2-01: VERIFIED renders as 'Security-Scanned'", () => {
    swrReturn = {
      data: {
        versions: [makeVersion({ certTier: "VERIFIED" })],
        count: 1,
        source: "platform",
        provider: "vskill",
        trackedForUpdates: true,
      },
      loading: false,
    };
    studioSkills = [];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const text = collectText(tree);

    expect(text).toContain("Security-Scanned");
    expect(text).not.toContain("VERIFIED");
  });

  it("AC-US2-02: unknown tier passes through unchanged", () => {
    swrReturn = {
      data: {
        versions: [makeVersion({ certTier: "EXPERIMENTAL" as VersionEntry["certTier"] })],
        count: 1,
        source: "platform",
        provider: "vskill",
        trackedForUpdates: true,
      },
      loading: false,
    };
    studioSkills = [];

    const tree = (VersionHistoryPanel as unknown as () => unknown)();
    const text = collectText(tree);

    expect(text).toContain("EXPERIMENTAL");
  });
});
