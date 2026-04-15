import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../utils/parseUnifiedDiff";
import type { UnifiedDiffLine } from "../utils/parseUnifiedDiff";

describe("parseUnifiedDiff", () => {
  it("returns empty array for empty string", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("parses a single hunk with additions and deletions", () => {
    const diff = `--- a/SKILL.md
+++ b/SKILL.md
@@ -1,3 +1,3 @@
 context line
-old line
+new line
 another context`;

    const lines = parseUnifiedDiff(diff);
    expect(lines).toEqual([
      { type: "header", content: "@@ -1,3 +1,3 @@" },
      { type: "context", content: "context line" },
      { type: "remove", content: "old line" },
      { type: "add", content: "new line" },
      { type: "context", content: "another context" },
    ]);
  });

  it("parses multi-hunk diff", () => {
    const diff = `--- a/file.md
+++ b/file.md
@@ -1,2 +1,2 @@
-first
+FIRST
 same
@@ -10,2 +10,3 @@
 before
+inserted
 after`;

    const lines = parseUnifiedDiff(diff);
    const headers = lines.filter((l) => l.type === "header");
    expect(headers.length).toBe(2);
    expect(lines.filter((l) => l.type === "add").length).toBe(2);
    expect(lines.filter((l) => l.type === "remove").length).toBe(1);
  });

  it("strips leading +/- from content", () => {
    const diff = `--- a/f
+++ b/f
@@ -1,1 +1,1 @@
-removed content
+added content`;

    const lines = parseUnifiedDiff(diff);
    const addLine = lines.find((l) => l.type === "add");
    const removeLine = lines.find((l) => l.type === "remove");
    expect(addLine?.content).toBe("added content");
    expect(removeLine?.content).toBe("removed content");
  });

  it("handles lines with special characters", () => {
    const diff = `--- a/f
+++ b/f
@@ -1,1 +1,1 @@
-const x = { a: 1, b: "hello+" };
+const x = { a: 2, b: "hello-world" };`;

    const lines = parseUnifiedDiff(diff);
    expect(lines.find((l) => l.type === "remove")?.content).toBe('const x = { a: 1, b: "hello+" };');
    expect(lines.find((l) => l.type === "add")?.content).toBe('const x = { a: 2, b: "hello-world" };');
  });

  it("skips file header lines (--- and +++)", () => {
    const diff = `--- a/SKILL.md
+++ b/SKILL.md
@@ -1,1 +1,1 @@
-old
+new`;

    const lines = parseUnifiedDiff(diff);
    expect(lines.some((l) => l.content.startsWith("--- a/"))).toBe(false);
    expect(lines.some((l) => l.content.startsWith("+++ b/"))).toBe(false);
  });

  it("handles empty context lines (space-only prefix)", () => {
    const diff = `--- a/f
+++ b/f
@@ -1,3 +1,3 @@

-old
+new
 `;

    const lines = parseUnifiedDiff(diff);
    const contextLines = lines.filter((l) => l.type === "context");
    expect(contextLines.length).toBe(2);
    expect(contextLines[0].content).toBe("");
  });
});
