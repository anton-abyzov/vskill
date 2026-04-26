// 0741 T-007: I/O contract test for the ported repo-utils helpers.
import { describe, it, expect } from "vitest";
import { parseRepoUrl, normalizeRepoUrl } from "../repo-utils";

describe("parseRepoUrl (ported from vskill-platform)", () => {
  it("returns null for non-GitHub URLs", () => {
    expect(parseRepoUrl("https://gitlab.com/foo/bar")).toBeNull();
    expect(parseRepoUrl("not-a-url")).toBeNull();
    expect(parseRepoUrl("")).toBeNull();
  });

  it("parses canonical https URLs and lowercases owner/name", () => {
    const info = parseRepoUrl("https://github.com/Anton-Abyzov/VSKILL");
    expect(info).toEqual({
      owner: "anton-abyzov",
      name: "vskill",
      url: "https://github.com/anton-abyzov/vskill",
    });
  });

  it("strips .git suffix", () => {
    const info = parseRepoUrl("https://github.com/foo/bar.git");
    expect(info?.name).toBe("bar");
    expect(info?.url).toBe("https://github.com/foo/bar");
  });

  it("ignores trailing path segments (tree/main, etc.)", () => {
    const info = parseRepoUrl("https://github.com/foo/bar/tree/main/skills");
    expect(info?.owner).toBe("foo");
    expect(info?.name).toBe("bar");
    expect(info?.url).toBe("https://github.com/foo/bar");
  });

  it("trims whitespace", () => {
    const info = parseRepoUrl("   https://github.com/foo/bar  ");
    expect(info?.owner).toBe("foo");
  });
});

describe("normalizeRepoUrl (ported)", () => {
  it("returns canonical URL for valid input", () => {
    expect(normalizeRepoUrl("https://github.com/Foo/Bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("returns null for invalid input", () => {
    expect(normalizeRepoUrl("nope")).toBeNull();
  });
});
