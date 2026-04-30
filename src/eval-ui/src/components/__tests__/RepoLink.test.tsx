// ---------------------------------------------------------------------------
// 0809 — RepoLink unit tests.
//
// RepoLink renders a clickable owner/repo chip in DetailHeader's byline when
// skill.repoUrl parses as a github.com URL. Returns null on unparseable input
// so non-github skills keep the existing 2-chip byline (no orphaned chip,
// no broken anchor).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { RepoLink, parseOwnerRepo } from "../RepoLink";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

describe("0809 parseOwnerRepo", () => {
  it("parses canonical https://github.com/{owner}/{repo}", () => {
    expect(parseOwnerRepo("https://github.com/anton-abyzov/greet-anton-test"))
      .toEqual({ owner: "anton-abyzov", repo: "greet-anton-test" });
  });

  it("strips /tree/<ref>[/path]", () => {
    expect(parseOwnerRepo("https://github.com/x/y/tree/feature/foo"))
      .toEqual({ owner: "x", repo: "y" });
  });

  it("strips /blob/<ref>[/path]", () => {
    expect(parseOwnerRepo("https://github.com/x/y/blob/main/skills/a/SKILL.md"))
      .toEqual({ owner: "x", repo: "y" });
  });

  it("strips trailing .git", () => {
    expect(parseOwnerRepo("https://github.com/x/y.git"))
      .toEqual({ owner: "x", repo: "y" });
  });

  it("accepts www.github.com (case-insensitive)", () => {
    expect(parseOwnerRepo("https://www.github.com/X/Y"))
      .toEqual({ owner: "X", repo: "Y" });
  });

  it("strips trailing slash", () => {
    expect(parseOwnerRepo("https://github.com/x/y/"))
      .toEqual({ owner: "x", repo: "y" });
  });

  it("strips query + hash", () => {
    expect(parseOwnerRepo("https://github.com/x/y?foo=bar#z"))
      .toEqual({ owner: "x", repo: "y" });
  });

  it("returns null for non-github hosts", () => {
    expect(parseOwnerRepo("https://gitlab.com/x/y")).toBeNull();
    expect(parseOwnerRepo("https://bitbucket.org/x/y")).toBeNull();
  });

  it("returns null for null / empty / unparseable inputs", () => {
    expect(parseOwnerRepo(null)).toBeNull();
    expect(parseOwnerRepo(undefined)).toBeNull();
    expect(parseOwnerRepo("")).toBeNull();
    expect(parseOwnerRepo("   ")).toBeNull();
    expect(parseOwnerRepo("not a url")).toBeNull();
  });

  it("returns null when path has too few or too many segments", () => {
    expect(parseOwnerRepo("https://github.com/owner-only")).toBeNull();
    // Excess segments (after canonicalRepoUrl strips /tree/ and /blob/, a third
    // segment that isn't tree/blob is left in place — and parseOwnerRepo rejects
    // it because path-segment count != 2).
    expect(parseOwnerRepo("https://github.com/x/y/z")).toBeNull();
  });

  it("rejects owner segments that violate GitHub username rules", () => {
    expect(parseOwnerRepo("https://github.com/-bad/repo")).toBeNull();
    expect(parseOwnerRepo("https://github.com/has space/repo")).toBeNull();
  });
});

describe("0809 RepoLink", () => {
  it("TC-019: renders an anchor with the canonical href and visible owner/repo text", () => {
    const tree = RepoLink({
      repoUrl: "https://github.com/anton-abyzov/greet-anton-test",
    }) as unknown as ReactEl;
    expect(tree).toBeTruthy();
    expect(tree.type).toBe("a");
    expect(tree.props.href).toBe("https://github.com/anton-abyzov/greet-anton-test");
    expect(tree.props.target).toBe("_blank");
    expect(tree.props.rel).toBe("noopener noreferrer");
    expect(tree.props["data-testid"]).toBe("repo-link");
    expect(collectText(tree)).toBe("anton-abyzov/greet-anton-test");
  });

  it("TC-020: returns null when repoUrl is null", () => {
    expect(RepoLink({ repoUrl: null })).toBeNull();
  });

  it("returns null when repoUrl is undefined", () => {
    expect(RepoLink({ repoUrl: undefined })).toBeNull();
  });

  it("returns null when repoUrl is empty/whitespace", () => {
    expect(RepoLink({ repoUrl: "" })).toBeNull();
    expect(RepoLink({ repoUrl: "   " })).toBeNull();
  });

  it("TC-021: canonicalizes /tree/<branch> URLs back to repo root", () => {
    const tree = RepoLink({
      repoUrl: "https://github.com/x/y/tree/feature/foo",
    }) as unknown as ReactEl;
    expect(tree.props.href).toBe("https://github.com/x/y");
  });

  it("TC-022: canonicalizes /blob/<branch>/path URLs back to repo root", () => {
    const tree = RepoLink({
      repoUrl: "https://github.com/x/y/blob/main/skills/a/SKILL.md",
    }) as unknown as ReactEl;
    expect(tree.props.href).toBe("https://github.com/x/y");
  });

  it("TC-023: strips trailing .git from the repo segment", () => {
    const tree = RepoLink({
      repoUrl: "https://github.com/x/y.git",
    }) as unknown as ReactEl;
    expect(tree.props.href).toBe("https://github.com/x/y");
    expect(collectText(tree)).toBe("x/y");
  });

  it("TC-024: accepts www.github.com", () => {
    const tree = RepoLink({
      repoUrl: "https://www.github.com/X/Y",
    }) as unknown as ReactEl;
    expect(tree.props.href).toBe("https://github.com/X/Y");
  });

  it("TC-025: returns null for non-github hosts", () => {
    expect(RepoLink({ repoUrl: "https://gitlab.com/x/y" })).toBeNull();
  });

  it("TC-026: returns null for unparseable strings", () => {
    expect(RepoLink({ repoUrl: "not a url" })).toBeNull();
  });

  it("respects custom data-testid override", () => {
    const tree = RepoLink({
      repoUrl: "https://github.com/x/y",
      "data-testid": "custom-repo",
    }) as unknown as ReactEl;
    expect(tree.props["data-testid"]).toBe("custom-repo");
  });
});
