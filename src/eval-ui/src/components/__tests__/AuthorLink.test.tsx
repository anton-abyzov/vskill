// ---------------------------------------------------------------------------
// T-003 (0707): AuthorLink tests — renders GitHub anchor when repoUrl
// parseable, copy chip otherwise.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { AuthorLink, parseGitHubOwner } from "../AuthorLink";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

describe("parseGitHubOwner", () => {
  it("extracts the owner segment from a github.com URL", () => {
    expect(parseGitHubOwner("https://github.com/anton-abyzov/vskill")).toBe("anton-abyzov");
    expect(parseGitHubOwner("https://github.com/anton-abyzov/vskill/tree/main")).toBe("anton-abyzov");
    expect(parseGitHubOwner("https://github.com/anton-abyzov")).toBe("anton-abyzov");
  });

  it("accepts raw.githubusercontent.com", () => {
    expect(parseGitHubOwner("https://raw.githubusercontent.com/anton-abyzov/vskill/main/README.md"))
      .toBe("anton-abyzov");
  });

  it("returns null for non-github hosts", () => {
    expect(parseGitHubOwner("https://gitlab.com/anton-abyzov/vskill")).toBeNull();
    expect(parseGitHubOwner("https://example.com")).toBeNull();
  });

  it("returns null for invalid / empty input", () => {
    expect(parseGitHubOwner(null)).toBeNull();
    expect(parseGitHubOwner(undefined)).toBeNull();
    expect(parseGitHubOwner("")).toBeNull();
    expect(parseGitHubOwner("not a url")).toBeNull();
  });
});

describe("AuthorLink — T-003", () => {
  it("renders an anchor to the GitHub profile when repoUrl parses", () => {
    const tree = AuthorLink({
      author: "Anton Abyzov",
      repoUrl: "https://github.com/anton-abyzov/vskill",
    }) as unknown as ReactEl;
    expect(tree.type).toBe("a");
    expect(tree.props.href).toBe("https://github.com/anton-abyzov");
    expect(tree.props.target).toBe("_blank");
    expect(tree.props.rel).toBe("noopener noreferrer");
    expect(collectText(tree)).toBe("Anton Abyzov");
  });

  it("renders a copy-to-clipboard button when no repoUrl is present", () => {
    const tree = AuthorLink({ author: "Anton" }) as unknown as ReactEl;
    expect(tree.type).toBe("button");
    expect(collectText(tree)).toContain("Anton");
    // No anchor children.
    const text = collectText(tree);
    expect(text.includes("https://")).toBe(false);
  });

  it("renders em-dash when both author and repoUrl are missing", () => {
    const tree = AuthorLink({ author: null, repoUrl: null }) as unknown as ReactEl;
    expect(collectText(tree)).toBe("—");
  });

  it("renders the repo owner as the link label when author is blank but owner parses", () => {
    const tree = AuthorLink({
      author: "",
      repoUrl: "https://github.com/anton-abyzov/vskill",
    }) as unknown as ReactEl;
    expect(tree.type).toBe("a");
    expect(collectText(tree)).toBe("anton-abyzov");
  });
});
