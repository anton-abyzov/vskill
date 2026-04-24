// ---------------------------------------------------------------------------
// T-004 (0707): SourceFileLink tests
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { SourceFileLink, buildBlobUrl, canonicalRepoUrl } from "../SourceFileLink";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

describe("canonicalRepoUrl", () => {
  it("strips /tree/<ref> suffix", () => {
    expect(canonicalRepoUrl("https://github.com/anton-abyzov/vskill/tree/main"))
      .toBe("https://github.com/anton-abyzov/vskill");
  });

  it("strips /blob/<ref>/... suffix", () => {
    expect(canonicalRepoUrl("https://github.com/anton-abyzov/vskill/blob/main/README.md"))
      .toBe("https://github.com/anton-abyzov/vskill");
  });

  it("passes through a bare repo URL unchanged", () => {
    expect(canonicalRepoUrl("https://github.com/anton-abyzov/vskill"))
      .toBe("https://github.com/anton-abyzov/vskill");
  });
});

describe("buildBlobUrl", () => {
  it("appends /blob/HEAD/<skillPath> and preserves the repo root", () => {
    expect(
      buildBlobUrl(
        "https://github.com/anton-abyzov/vskill/tree/main",
        "plugins/easychamp/skills/tournament-manager",
      ),
    ).toBe("https://github.com/anton-abyzov/vskill/blob/HEAD/plugins/easychamp/skills/tournament-manager");
  });
});

describe("SourceFileLink — T-004", () => {
  it("renders an anchor with /blob/HEAD/<path> href and trailing ↗", () => {
    const tree = SourceFileLink({
      repoUrl: "https://github.com/anton-abyzov/vskill/tree/main",
      skillPath: "plugins/easychamp/skills/tournament-manager",
    }) as unknown as ReactEl;
    expect(tree.type).toBe("a");
    expect(tree.props.href).toBe(
      "https://github.com/anton-abyzov/vskill/blob/HEAD/plugins/easychamp/skills/tournament-manager",
    );
    expect(tree.props.target).toBe("_blank");
    expect(tree.props.rel).toBe("noopener noreferrer");
    const text = collectText(tree);
    expect(text).toContain("tournament-manager");
    expect(text).toContain("↗");
  });

  it("renders a copy button with the absolute path when no repoUrl is present", () => {
    const tree = SourceFileLink({
      absolutePath: "/Users/test/.claude/skills/foo",
    }) as unknown as ReactEl;
    expect(tree.type).toBe("button");
    expect(collectText(tree)).toContain("foo");
  });

  it("renders em-dash when neither repoUrl nor paths are provided", () => {
    const tree = SourceFileLink({}) as unknown as ReactEl;
    expect(collectText(tree)).toBe("—");
  });
});
