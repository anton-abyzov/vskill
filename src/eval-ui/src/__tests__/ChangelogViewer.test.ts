import { describe, it, expect, vi } from "vitest";

// Since we don't have jsdom/React testing lib in this project,
// we test the ChangelogViewer's helper logic and exported props interface.
// The component rendering is verified via TypeScript compilation + E2E.

import { parseUnifiedDiff } from "../utils/parseUnifiedDiff";

describe("ChangelogViewer logic", () => {
  const sampleDiff = `--- a/SKILL.md
+++ b/SKILL.md
@@ -1,4 +1,5 @@
 # Architect Skill

-Old description here
+New description here
+Added feature line
 ## Usage`;

  it("parses diff for rendering with correct line types", () => {
    const lines = parseUnifiedDiff(sampleDiff);
    const adds = lines.filter((l) => l.type === "add");
    const removes = lines.filter((l) => l.type === "remove");
    const contexts = lines.filter((l) => l.type === "context");

    expect(adds.length).toBe(2);
    expect(removes.length).toBe(1);
    expect(contexts.length).toBe(3);
  });

  it("computes stats from parsed diff", () => {
    const lines = parseUnifiedDiff(sampleDiff);
    const added = lines.filter((l) => l.type === "add").length;
    const removed = lines.filter((l) => l.type === "remove").length;
    expect(added).toBe(2);
    expect(removed).toBe(1);
  });

  it("returns empty for empty diff (error/empty state path)", () => {
    const lines = parseUnifiedDiff("");
    expect(lines).toEqual([]);
  });

  it("computes line numbers correctly", () => {
    const lines = parseUnifiedDiff(sampleDiff);
    // Filter out headers to compute line numbering
    const contentLines = lines.filter((l) => l.type !== "header");
    let origLine = 0;
    let newLine = 0;
    const numbered = contentLines.map((line) => {
      if (line.type === "remove") {
        origLine++;
        return { ...line, origNum: origLine, newNum: null };
      } else if (line.type === "add") {
        newLine++;
        return { ...line, origNum: null, newNum: newLine };
      } else {
        origLine++;
        newLine++;
        return { ...line, origNum: origLine, newNum: newLine };
      }
    });

    // "# Architect Skill" = context => orig:1, new:1
    expect(numbered[0].origNum).toBe(1);
    expect(numbered[0].newNum).toBe(1);

    // "Old description" = remove => orig:3, new:null
    const removeLine = numbered.find((l) => l.type === "remove");
    expect(removeLine?.origNum).toBe(3);
    expect(removeLine?.newNum).toBeNull();

    // "New description" = add => orig:null, new:3
    const addLines = numbered.filter((l) => l.type === "add");
    expect(addLines[0].origNum).toBeNull();
    expect(addLines[0].newNum).toBe(3);
  });
});
