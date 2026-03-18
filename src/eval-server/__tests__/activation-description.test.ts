import { describe, it, expect } from "vitest";
import { extractDescription } from "../api-routes.js";

describe("extractDescription (T-010 / 0566)", () => {
  it("extracts description from frontmatter", () => {
    const content = `---
name: my-skill
description: "My skill desc"
tags: foo, bar
---

# My Skill

Body content here.`;
    expect(extractDescription(content)).toBe("My skill desc");
  });

  it("falls back to body content when no description field in frontmatter", () => {
    const content = `---
name: my-skill
tags: foo
---

Body content without description field.`;
    expect(extractDescription(content)).toBe("Body content without description field.");
  });

  it("falls back to first 500 chars when no frontmatter at all", () => {
    const content = "This is raw content without any frontmatter.";
    expect(extractDescription(content)).toBe("This is raw content without any frontmatter.");
  });

  it("returns empty string for empty input", () => {
    expect(extractDescription("")).toBe("");
  });

  it("truncates body to 500 chars when longer", () => {
    const body = "A".repeat(600);
    const content = `---
name: test
---

${body}`;
    const result = extractDescription(content);
    expect(result).toHaveLength(500);
  });

  it("returns empty string when frontmatter only with empty body", () => {
    const content = `---
name: test
---
`;
    expect(extractDescription(content)).toBe("");
  });
});
