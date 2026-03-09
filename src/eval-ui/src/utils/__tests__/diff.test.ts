import { describe, it, expect } from "vitest";
import { computeDiff } from "../diff";

describe("computeDiff", () => {
  it("returns all unchanged for identical inputs", () => {
    const text = "line1\nline2\nline3";
    const result = computeDiff(text, text);
    expect(result.every((l) => l.type === "unchanged")).toBe(true);
    expect(result).toHaveLength(3);
  });

  it("marks all lines as added for empty original", () => {
    const result = computeDiff("", "line1\nline2");
    const added = result.filter((l) => l.type === "added");
    expect(added).toHaveLength(2);
    expect(added[0].content).toBe("line1");
    expect(added[1].content).toBe("line2");
  });

  it("marks all lines as removed for empty improved", () => {
    const result = computeDiff("line1\nline2", "");
    const removed = result.filter((l) => l.type === "removed");
    expect(removed).toHaveLength(2);
    expect(removed[0].content).toBe("line1");
    expect(removed[1].content).toBe("line2");
  });

  it("detects pure additions", () => {
    const original = "line1\nline3";
    const improved = "line1\nline2\nline3";
    const result = computeDiff(original, improved);
    const added = result.filter((l) => l.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe("line2");
  });

  it("detects pure deletions", () => {
    const original = "line1\nline2\nline3";
    const improved = "line1\nline3";
    const result = computeDiff(original, improved);
    const removed = result.filter((l) => l.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe("line2");
  });

  it("handles mixed edits correctly", () => {
    const original = "---\ndescription: old\n---\nContent stays";
    const improved = "---\ndescription: new\nmodel: opus\n---\nContent stays";
    const result = computeDiff(original, improved);

    // Verify key properties
    expect(result.some((l) => l.type === "removed" && l.content === "description: old")).toBe(true);
    expect(result.some((l) => l.type === "added" && l.content === "description: new")).toBe(true);
    expect(result.some((l) => l.type === "added" && l.content === "model: opus")).toBe(true);
    expect(result.some((l) => l.type === "unchanged" && l.content === "Content stays")).toBe(true);
  });
});
