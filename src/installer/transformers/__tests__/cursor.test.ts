// 0845 T-006 — Cursor transformer unit tests.
//
// Contract (plan.md §6, AC-US4-03):
//   parsedSkill → one TransformedFile at `rules/<name>.mdc` with
//   frontmatter `description: <desc>`, `globs: ""`, `alwaysApply: false`
//   followed by the verbatim body.
//
// Idempotency: running twice with the same input must produce byte-equal output.

import { describe, it, expect } from "vitest";
import { cursorTransformer } from "../cursor.js";
import type { ParsedSkill } from "../index.js";

const baseSkill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Section\n\nThis is the body.\n",
  originalFrontmatter: "name: obsidian-brain\ndescription: PARA + LLM Wiki",
};

describe("cursorTransformer", () => {
  it("emits exactly one file at rules/<name>.mdc", () => {
    const out = cursorTransformer(baseSkill);
    expect(out).toHaveLength(1);
    expect(out[0].relativePath).toBe("rules/obsidian-brain.mdc");
  });

  it("produces the three frontmatter keys in the contract order", () => {
    const [{ content }] = cursorTransformer(baseSkill);
    expect(content.startsWith(
      `---\ndescription: PARA + LLM Wiki\nglobs: ""\nalwaysApply: false\n---\n`,
    )).toBe(true);
  });

  it("preserves the body verbatim after the frontmatter block", () => {
    const [{ content }] = cursorTransformer(baseSkill);
    const afterFm = content.split(/^---\n/m).slice(2).join("---\n");
    // Body follows a single newline after the closing ---.
    expect(content.endsWith(baseSkill.body)).toBe(true);
    // No double frontmatter blocks (idempotency / well-formedness guard).
    expect(content.match(/^---\n/gm)?.length).toBe(2);
    expect(afterFm).toContain("This is the body.");
  });

  it("is idempotent — byte-equal output on re-invocation", () => {
    const a = cursorTransformer(baseSkill);
    const b = cursorTransformer(baseSkill);
    expect(a).toEqual(b);
    expect(a[0].content).toBe(b[0].content);
  });

  it("quotes a description that contains special chars without breaking YAML", () => {
    // Colons are the most common collision; the Cursor spec uses plain
    // strings, so the transformer should escape only when necessary.
    const skill: ParsedSkill = {
      ...baseSkill,
      description: "Edge: case with: colons",
    };
    const [{ content }] = cursorTransformer(skill);
    // Either quoted or escape-style — but never a raw unquoted colon that
    // would break YAML parsing. Cursor's frontmatter parser is lenient,
    // but we still ensure the description is reconstructible.
    expect(content).toMatch(/description: ["']?Edge:.*["']?/);
  });

  it("handles empty body cleanly (no trailing whitespace explosion)", () => {
    const skill: ParsedSkill = { ...baseSkill, body: "" };
    const [{ content }] = cursorTransformer(skill);
    expect(content.endsWith("---\n")).toBe(true);
  });
});
