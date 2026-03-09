import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../parseFrontmatter";

describe("parseFrontmatter", () => {
  it("parses description and model fields", () => {
    const content = `---
description: "A test skill"
model: opus
---
Body content here.`;

    const { metadata, body } = parseFrontmatter(content);
    expect(metadata.description).toBe("A test skill");
    expect(metadata.model).toBe("opus");
    expect(body).toBe("Body content here.");
  });

  it("parses allowed-tools as array (inline format)", () => {
    const content = `---
allowed-tools: [slack_post, github_create_pr, linear_create_issue]
---
Body.`;

    const { metadata } = parseFrontmatter(content);
    expect(Array.isArray(metadata["allowed-tools"])).toBe(true);
    expect(metadata["allowed-tools"]).toHaveLength(3);
    expect(metadata["allowed-tools"]).toContain("slack_post");
  });

  it("parses allowed-tools as YAML list", () => {
    const content = `---
allowed-tools:
  - slack_post
  - github_create_pr
---
Body.`;

    const { metadata } = parseFrontmatter(content);
    expect(Array.isArray(metadata["allowed-tools"])).toBe(true);
    expect(metadata["allowed-tools"]).toContain("slack_post");
    expect(metadata["allowed-tools"]).toContain("github_create_pr");
  });

  it("returns empty metadata and full body for no frontmatter", () => {
    const content = `Just markdown content without frontmatter.

Second paragraph.`;

    const { metadata, body } = parseFrontmatter(content);
    expect(Object.keys(metadata)).toHaveLength(0);
    expect(body).toBe(content);
  });

  it("handles empty allowed-tools gracefully", () => {
    const content = `---
description: "test"
---
Body.`;

    const { metadata } = parseFrontmatter(content);
    expect(metadata["allowed-tools"]).toBeUndefined();
  });

  it("strips quotes from values", () => {
    const content = `---
description: "Quoted value"
context: 'single-quoted'
---
Body.`;

    const { metadata } = parseFrontmatter(content);
    expect(metadata.description).toBe("Quoted value");
    expect(metadata.context).toBe("single-quoted");
  });
});
