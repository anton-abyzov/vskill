import { describe, it, expect } from "vitest";
import {
  ensureFrontmatter,
  validateSkillNameStrict,
  extractDescription,
} from "./frontmatter.js";

describe("ensureFrontmatter", () => {
  // TC-001 (AC-US1-01): no frontmatter → prepend new block with name
  it("prepends frontmatter with name when content has no frontmatter", () => {
    const content = "# My Skill\n\nDoes cool things.";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("name: my-skill");
    expect(result).toContain("# My Skill");
  });

  // TC-002 (AC-US1-02): frontmatter missing name → inject name
  it("injects name into existing frontmatter that lacks it", () => {
    const content = "---\ndescription: A skill\n---\n# Body";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toContain("name: my-skill");
    expect(result).toContain("description: A skill");
  });

  // TC-003 (AC-US1-03): frontmatter missing description → inject from body
  it("injects description from first paragraph when missing", () => {
    const content = "---\nname: my-skill\n---\n# Heading\n\nFirst paragraph text";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toContain("description: First paragraph text");
  });

  // TC-004 (AC-US1-04): both present → return unchanged
  it("returns content unchanged when both name and description exist", () => {
    const content =
      "---\nname: my-skill\ndescription: Already set\n---\n# Body";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toBe(content);
  });

  // TC-005 (AC-US1-05): author name preserved even if different from skillName
  it("preserves author-set name even when it differs from skillName", () => {
    const content = "---\nname: author-chosen-name\n---\n# Body";
    const result = ensureFrontmatter(content, "different-name");
    expect(result).toContain("name: author-chosen-name");
    expect(result).not.toContain("name: different-name");
  });

  // TC-006 (Edge case — empty body): description falls back to humanized name
  it("uses humanized skill name as description when body is empty", () => {
    const content = "";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toContain("description: my skill");
  });

  // TC-007 (Edge case — CRLF): normalizes line endings
  it("normalizes CRLF to LF and does not corrupt content", () => {
    const content = "---\r\nname: my-skill\r\n---\r\n# Body\r\nParagraph";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).not.toContain("\r");
    expect(result).toContain("name: my-skill");
    expect(result).toContain("# Body");
  });

  // TC-008 (Edge case — malformed frontmatter): no closing --- → treat as no frontmatter
  it("treats malformed frontmatter (no closing ---) as no frontmatter", () => {
    const content = "---\nbroken: [unclosed\nsome content here";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toMatch(/^---\n/);
    expect(result).toContain("name: my-skill");
    // The original content should still be present after the new frontmatter
    expect(result).toContain("---\nbroken: [unclosed");
  });

  // TC-009 (NFR — extra fields preserved)
  it("preserves extra frontmatter fields untouched", () => {
    const content =
      "---\nauthor: Alice\nversion: 1.0\n---\n# Body";
    const result = ensureFrontmatter(content, "my-skill");
    expect(result).toContain("author: Alice");
    expect(result).toContain("version: 1.0");
    expect(result).toContain("name: my-skill");
  });
});

describe("validateSkillNameStrict", () => {
  // TC-010 (AC-US3-01): valid names return true
  it("returns true for valid skill names", () => {
    for (const name of ["a", "my-skill", "abc123", "a1b2c3", "a-b-c"]) {
      expect(validateSkillNameStrict(name)).toBe(true);
    }
  });

  // TC-011 (AC-US3-02): uppercase → false
  it("returns false for names with uppercase letters", () => {
    for (const name of ["MySkill", "MY-SKILL", "Abc"]) {
      expect(validateSkillNameStrict(name)).toBe(false);
    }
  });

  // TC-012 (AC-US3-03): underscores or spaces → false
  it("returns false for names with underscores or spaces", () => {
    for (const name of ["my_skill", "my skill", "my-skill_v2"]) {
      expect(validateSkillNameStrict(name)).toBe(false);
    }
  });

  // TC-013 (AC-US3-04): empty or >64 chars → false
  it("returns false for empty string or name exceeding 64 characters", () => {
    expect(validateSkillNameStrict("")).toBe(false);
    expect(validateSkillNameStrict("a".repeat(65))).toBe(false);
  });

  // TC-014 (AC-US3-05): leading/trailing hyphens → false
  it("returns false for names starting or ending with a hyphen", () => {
    for (const name of ["-my-skill", "my-skill-", "-"]) {
      expect(validateSkillNameStrict(name)).toBe(false);
    }
  });
});

describe("extractDescription", () => {
  // TC-015 (AC-US1-03): first non-heading paragraph extracted
  it("extracts first non-heading, non-blank line from body", () => {
    const body = "# Title\n\nThis is the description. More text.";
    expect(extractDescription(body, "my-skill")).toBe(
      "This is the description. More text."
    );
  });

  // TC-016 (AC-US1-03): only headings → humanized fallback
  it("returns humanized skill name when body has only headings", () => {
    const body = "# Title\n## Subtitle\n";
    expect(extractDescription(body, "my-skill")).toBe("my skill");
  });

  // TC-017 (Edge case — truncation): >200 chars truncated
  it("truncates description to 200 characters", () => {
    const longParagraph = "A".repeat(250);
    const body = `# Title\n\n${longParagraph}`;
    const result = extractDescription(body, "my-skill");
    expect(result.length).toBeLessThanOrEqual(200);
  });
});
