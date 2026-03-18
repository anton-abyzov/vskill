import { describe, it, expect } from "vitest";
import { resolve, sep } from "node:path";
import { isDraftWithinRoot } from "../skill-create-routes.js";

describe("isDraftWithinRoot", () => {
  const root = "/Users/foo/project";

  it("allows paths inside the root", () => {
    expect(isDraftWithinRoot("/Users/foo/project/plugins/draft", root)).toBe(true);
  });

  it("rejects paths outside the root with overlapping prefix", () => {
    // This is the prefix collision bug: /project-evil starts with /project
    expect(isDraftWithinRoot("/Users/foo/project-evil/data", root)).toBe(false);
  });

  it("rejects paths completely outside the root", () => {
    expect(isDraftWithinRoot("/tmp/malicious", root)).toBe(false);
  });

  it("rejects the root itself", () => {
    expect(isDraftWithinRoot("/Users/foo/project", root)).toBe(false);
  });

  it("allows nested subdirectories", () => {
    expect(isDraftWithinRoot("/Users/foo/project/a/b/c/d", root)).toBe(true);
  });

  it("handles trailing separators in root", () => {
    expect(isDraftWithinRoot("/Users/foo/project/draft", "/Users/foo/project/")).toBe(true);
  });
});
