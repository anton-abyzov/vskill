import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../renderMarkdown";

describe("renderMarkdown", () => {
  describe("headers", () => {
    it("renders h1", () => {
      const html = renderMarkdown("# Title");
      expect(html).toContain("Title");
      expect(html).toMatch(/font-weight.*700|font-size.*1rem/);
      expect(html).not.toContain("# Title");
    });

    it("renders h2", () => {
      const html = renderMarkdown("## Subtitle");
      expect(html).toContain("Subtitle");
      expect(html).not.toContain("## Subtitle");
    });

    it("renders h3", () => {
      const html = renderMarkdown("### Section");
      expect(html).toContain("Section");
      expect(html).not.toContain("### Section");
    });
  });

  describe("inline formatting", () => {
    it("renders bold", () => {
      const html = renderMarkdown("**bold text**");
      expect(html).toContain("<strong>bold text</strong>");
    });

    it("renders italic", () => {
      const html = renderMarkdown("*italic text*");
      expect(html).toContain("<em>italic text</em>");
    });

    it("renders inline code", () => {
      const html = renderMarkdown("`some code`");
      expect(html).toContain("<code");
      expect(html).toContain("some code");
      expect(html).toContain("</code>");
    });
  });

  describe("code blocks", () => {
    it("renders fenced code block", () => {
      const md = "```js\nconst x = 1;\n```";
      const html = renderMarkdown(md);
      expect(html).toContain("<pre");
      expect(html).toContain("<code>");
      expect(html).toContain("const x = 1;");
    });

    it("preserves whitespace in code blocks", () => {
      const md = "```\n  indented\n    more indented\n```";
      const html = renderMarkdown(md);
      expect(html).toContain("  indented");
      expect(html).toContain("    more indented");
    });
  });

  describe("lists", () => {
    it("renders unordered list items", () => {
      const html = renderMarkdown("- item one\n- item two");
      // Should contain bullet character
      expect(html).toMatch(/\u2022.*item one/);
      expect(html).toMatch(/\u2022.*item two/);
    });

    it("renders ordered list items", () => {
      const html = renderMarkdown("1. first\n2. second");
      expect(html).toContain("1.");
      expect(html).toContain("first");
      expect(html).toContain("2.");
      expect(html).toContain("second");
    });
  });

  describe("links", () => {
    it("renders anchor with target=_blank", () => {
      const html = renderMarkdown("[Go here](https://example.com)");
      expect(html).toContain('<a ');
      expect(html).toContain('href="https://example.com"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain("Go here");
    });

    it("handles multiple links on one line", () => {
      const html = renderMarkdown("[A](https://a.com) and [B](https://b.com)");
      expect(html).toContain('href="https://a.com"');
      expect(html).toContain('href="https://b.com"');
    });
  });

  describe("tables", () => {
    it("renders table with thead and tbody", () => {
      const md = "| Name | Value |\n| --- | --- |\n| foo | bar |\n| baz | qux |";
      const html = renderMarkdown(md);
      expect(html).toContain("<table");
      expect(html).toContain("<thead>");
      expect(html).toContain("<tbody>");
      expect(html).toContain("Name");
      expect(html).toContain("foo");
      expect(html).toContain("qux");
    });

    it("handles minimal two-column table", () => {
      const md = "| A | B |\n| - | - |\n| 1 | 2 |";
      const html = renderMarkdown(md);
      expect(html).toContain("<table");
      expect(html).toContain("<th");
      expect(html).toContain("<td");
    });

    it("does not treat lines without separator as table", () => {
      const md = "| just | a | line |\n\nSome text";
      const html = renderMarkdown(md);
      expect(html).not.toContain("<table");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(renderMarkdown("")).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(renderMarkdown(undefined as unknown as string)).toBe("");
    });

    it("renders mixed content correctly", () => {
      const md = "# Title\n\nSome **bold** text with `code`.\n\n- item\n\n[link](https://x.com)";
      const html = renderMarkdown(md);
      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<code");
      expect(html).toMatch(/\u2022.*item/);
      expect(html).toContain('href="https://x.com"');
    });
  });
});
