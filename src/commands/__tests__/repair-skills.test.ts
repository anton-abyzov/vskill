import { describe, it, expect } from "vitest";
import { detectCorruption } from "../repair-skills.js";

describe("detectCorruption", () => {
  it("returns no reasons for a pristine SKILL.md", () => {
    const content =
      "---\nname: my-skill\ndescription: A clean skill.\n---\n# Body";
    expect(detectCorruption(content)).toEqual([]);
  });

  it("flags duplicated name token (frontend-design corruption pattern)", () => {
    const content =
      "---\nname: frontend-design frontend-design\ndescription: x\n---\n";
    const reasons = detectCorruption(content);
    expect(reasons.some((r) => r.includes("duplicated-name-value"))).toBe(true);
  });

  it("flags multiple description: lines", () => {
    const content =
      "---\nname: skill\ndescription: First\nlicense: MIT\ndescription: Second\n---\n";
    const reasons = detectCorruption(content);
    expect(reasons.some((r) => /description: lines/.test(r))).toBe(true);
  });

  it("flags both patterns together (full frontend-design corruption)", () => {
    const content =
      '---\nversion: "1.0.0"\nname: frontend-design frontend-design\ndescription: a\nlicense: x\ndescription: "b"\n---\n';
    const reasons = detectCorruption(content);
    expect(reasons.length).toBe(2);
  });

  it("does not flag content without frontmatter", () => {
    expect(detectCorruption("# Just a heading\n")).toEqual([]);
  });

  it("normalizes CRLF before scanning", () => {
    const content =
      "---\r\nname: skill skill\r\ndescription: x\r\n---\r\n";
    const reasons = detectCorruption(content);
    expect(reasons.some((r) => r.includes("duplicated-name-value"))).toBe(true);
  });

  it("does not false-positive on names that legitimately contain spaces in different tokens", () => {
    // Single token with a hyphen, not duplicated.
    const content =
      "---\nname: frontend-design\ndescription: x\n---\n";
    expect(detectCorruption(content)).toEqual([]);
  });
});
