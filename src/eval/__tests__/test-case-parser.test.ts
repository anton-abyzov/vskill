import { describe, it, expect } from "vitest";
import {
  parseTestCases,
  serializeTestCases,
  upsertTestCasesIntoSkillMd,
} from "../test-case-parser.js";
import type { ParsedTestCase } from "../test-case-parser.js";

describe("parseTestCases", () => {
  it("T-001: parses 3-pair fixture (should activate / should not activate / auto)", () => {
    const content = `---
name: foo
description: bar
---

# Foo

## Test Cases

- Prompt: "how do I write a unit test?"
  Expected: "should activate"
- Prompt: "what is the weather?"
  Expected: "should not activate"
- Prompt: "tell me a joke"
  Expected: "auto"
`;
    const result = parseTestCases(content);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ prompt: "how do I write a unit test?", expected: "should_activate" });
    expect(result[1]).toEqual({ prompt: "what is the weather?", expected: "should_not_activate" });
    expect(result[2]).toEqual({ prompt: "tell me a joke", expected: "auto" });
  });

  it("T-002: returns [] when no ## Test Cases section", () => {
    const content = `---
name: foo
---

# Foo

Some prose, no test cases.
`;
    expect(parseTestCases(content)).toEqual([]);
  });

  it("T-003: returns [] when section heading present but body has no Prompt/Expected pairs", () => {
    const content = `## Test Cases

This section has prose but no - Prompt: ... Expected: ... pairs.

Some other text.
`;
    expect(parseTestCases(content)).toEqual([]);
  });

  it("T-004: section regex stops at next ## heading", () => {
    const content = `## Test Cases

- Prompt: "in scope"
  Expected: "should activate"

## Notes

- Prompt: "out of scope"
  Expected: "should activate"
`;
    const result = parseTestCases(content);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("in scope");
  });

  it("handles empty input", () => {
    expect(parseTestCases("")).toEqual([]);
  });
});

describe("serializeTestCases", () => {
  it("T-005: emits parseable block matching the platform's parse regex", () => {
    const prompts: ParsedTestCase[] = [
      { prompt: "a", expected: "should_activate" },
      { prompt: "b", expected: "should_not_activate" },
      { prompt: "c", expected: "auto" },
    ];
    const result = serializeTestCases(prompts);
    expect(result).toMatch(/^## Test Cases\n\n/);
    expect(result).toContain('- Prompt: "a"\n  Expected: "should activate"');
    expect(result).toContain('- Prompt: "b"\n  Expected: "should not activate"');
    expect(result).toContain('- Prompt: "c"\n  Expected: "auto"');
  });

  it("returns empty string when prompts is empty", () => {
    expect(serializeTestCases([])).toBe("");
  });
});

describe("round-trip", () => {
  it("T-006: parse(serialize(prompts)) === prompts (idempotent)", () => {
    const prompts: ParsedTestCase[] = [
      { prompt: "send a slack message in #general", expected: "should_activate" },
      { prompt: "what is the capital of France?", expected: "should_not_activate" },
      { prompt: "summarize this PDF", expected: "auto" },
    ];
    const serialized = serializeTestCases(prompts);
    const reparsed = parseTestCases(serialized);
    expect(reparsed).toEqual(prompts);
  });
});

describe("upsertTestCasesIntoSkillMd", () => {
  it("T-007: appends ## Test Cases when none exists; preserves frontmatter and other body sections", () => {
    const original = `---
name: foo
description: A test skill.
---

# Foo

## Workflow

Do the workflow.

## Examples

Some examples.
`;
    const prompts: ParsedTestCase[] = [{ prompt: "p1", expected: "should_activate" }];
    const result = upsertTestCasesIntoSkillMd(original, prompts);

    // Frontmatter preserved
    expect(result).toMatch(/^---\nname: foo\ndescription: A test skill\.\n---\n/);
    // Original sections preserved
    expect(result).toContain("## Workflow\n\nDo the workflow.");
    expect(result).toContain("## Examples\n\nSome examples.");
    // New Test Cases section appended
    expect(result).toContain('## Test Cases\n\n- Prompt: "p1"\n  Expected: "should activate"');
    // Round-trips
    expect(parseTestCases(result)).toEqual(prompts);
  });

  it("T-008: replaces existing ## Test Cases block; surrounding sections intact", () => {
    const original = `---
name: foo
---

## Workflow

Workflow body.

## Test Cases

- Prompt: "old"
  Expected: "should activate"

## Examples

Examples body.
`;
    const prompts: ParsedTestCase[] = [
      { prompt: "new1", expected: "should_activate" },
      { prompt: "new2", expected: "should_not_activate" },
    ];
    const result = upsertTestCasesIntoSkillMd(original, prompts);

    // Old prompts gone
    expect(result).not.toContain('"old"');
    // New prompts present
    expect(result).toContain('"new1"');
    expect(result).toContain('"new2"');
    // Surrounding sections preserved
    expect(result).toContain("## Workflow\n\nWorkflow body.");
    expect(result).toContain("## Examples\n\nExamples body.");
    // Round-trips
    expect(parseTestCases(result)).toEqual(prompts);
  });

  it("removes the ## Test Cases section when prompts is empty", () => {
    const original = `---
name: foo
---

## Workflow

Body.

## Test Cases

- Prompt: "old"
  Expected: "should activate"

## Examples

Body 2.
`;
    const result = upsertTestCasesIntoSkillMd(original, []);
    expect(result).not.toContain("## Test Cases");
    expect(result).not.toContain('"old"');
    expect(result).toContain("## Workflow");
    expect(result).toContain("## Examples");
  });

  it("appends to a SKILL.md with no body sections", () => {
    const original = `---
name: foo
description: ""
---

# Foo
`;
    const prompts: ParsedTestCase[] = [{ prompt: "x", expected: "auto" }];
    const result = upsertTestCasesIntoSkillMd(original, prompts);
    expect(parseTestCases(result)).toEqual(prompts);
    expect(result).toMatch(/^---\nname: foo/);
  });
});
