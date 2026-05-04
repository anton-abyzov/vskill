// ---------------------------------------------------------------------------
// Unit tests for applyForkMetadata in src/installer/frontmatter.ts (T-012,
// AC-US1-02). Covers:
//   - preservation of unknown frontmatter fields
//   - idempotence on rerun (byte-equal output)
//   - namespace rewrite
//   - version reset
//   - forkedFrom injection (insertion path AND replacement path)
//   - malformed-frontmatter handling (throws cleanly, does not silently corrupt)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { applyForkMetadata } from "../frontmatter.js";

describe("applyForkMetadata — namespace + author + version rewrite", () => {
  it("rewrites name, author, and version while preserving unknown fields", () => {
    const content = [
      "---",
      "name: sw/ado-mapper",
      "description: Map SpecWeave to ADO.",
      "author: Original Author",
      "version: 2.1.0",
      "custom-tag: yes-quoted",
      "license: MIT",
      "tags: [adobe, mapping]",
      "---",
      "",
      "# Body content",
      "",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/ado-mapper",
      author: "Anton",
      version: "1.0.0",
      forkedFrom: "sw/ado-mapper",
    });

    expect(result).toContain("name: anton/ado-mapper");
    expect(result).toContain("author: Anton");
    expect(result).toContain("version: 1.0.0");
    expect(result).toContain("forkedFrom: sw/ado-mapper");
    expect(result).toContain("custom-tag: yes-quoted");
    expect(result).toContain("license: MIT");
    expect(result).toContain("tags: [adobe, mapping]");
    expect(result).toContain("# Body content");

    // The old values must NOT survive the rewrite.
    expect(result).not.toContain("name: sw/ado-mapper");
    expect(result).not.toContain("author: Original Author");
    expect(result).not.toContain("version: 2.1.0");
  });

  it("inserts name when frontmatter lacks one", () => {
    const content = [
      "---",
      "description: A skill without a name",
      "author: Bob",
      "version: 0.5.0",
      "---",
      "# body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/no-name",
      author: "Anton",
      version: "1.0.0",
    });

    expect(result).toContain("name: anton/no-name");
    expect(result).toContain("author: Anton");
    expect(result).toContain("version: 1.0.0");
  });

  it("inserts author and version when absent", () => {
    const content = [
      "---",
      "name: legacy-skill",
      "description: Legacy skill with bare frontmatter.",
      "---",
      "# body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/legacy-skill",
      author: "Anton",
      version: "1.0.0",
    });

    expect(result).toContain("name: anton/legacy-skill");
    expect(result).toContain("author: Anton");
    expect(result).toContain("version: 1.0.0");
    // Description preserved verbatim — only the listed fields are touched.
    expect(result).toContain("description: Legacy skill with bare frontmatter.");
  });

  it("replaces an existing forkedFrom line rather than appending a duplicate", () => {
    const content = [
      "---",
      "name: someone-else/ado-mapper",
      "description: A previously forked skill.",
      "author: Someone Else",
      "version: 2.0.0",
      "forkedFrom: original/ado-mapper",
      "---",
      "# body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/ado-mapper",
      author: "Anton",
      version: "1.0.0",
      forkedFrom: "someone-else/ado-mapper",
    });

    const forkedFromLines = result.match(/^forkedFrom:/gm) ?? [];
    expect(forkedFromLines).toHaveLength(1);
    expect(result).toContain("forkedFrom: someone-else/ado-mapper");
    expect(result).not.toContain("forkedFrom: original/ado-mapper");
  });

  it("omits forkedFrom from frontmatter when not supplied", () => {
    const content = [
      "---",
      "name: foo",
      "description: foo skill",
      "author: A",
      "version: 1.0.0",
      "---",
      "# body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/foo",
      author: "Anton",
      version: "1.0.0",
    });

    expect(result).not.toContain("forkedFrom:");
  });
});

// ---------------------------------------------------------------------------

describe("applyForkMetadata — idempotence", () => {
  it("produces byte-equal output on second invocation with same args", () => {
    const content = [
      "---",
      "name: sw/skill",
      "description: A skill.",
      "author: Original",
      "version: 2.0.0",
      "license: MIT",
      "---",
      "# body",
      "",
    ].join("\n");

    const meta = {
      name: "anton/skill",
      author: "Anton",
      version: "1.0.0",
      forkedFrom: "sw/skill",
    } as const;

    const first = applyForkMetadata(content, meta);
    const second = applyForkMetadata(first, meta);

    expect(second).toBe(first);
  });

  it("produces byte-equal output across three consecutive calls (no drift)", () => {
    const content = [
      "---",
      "name: sw/x",
      "description: x.",
      "author: Old",
      "version: 9.9.9",
      "---",
      "body",
    ].join("\n");

    const meta = { name: "anton/x", author: "Anton", version: "1.0.0" } as const;

    const r1 = applyForkMetadata(content, meta);
    const r2 = applyForkMetadata(r1, meta);
    const r3 = applyForkMetadata(r2, meta);

    expect(r2).toBe(r1);
    expect(r3).toBe(r1);
  });
});

// ---------------------------------------------------------------------------

describe("applyForkMetadata — value escaping", () => {
  it("YAML-escapes author values containing special characters", () => {
    const content = [
      "---",
      "name: x",
      "description: d",
      "---",
      "body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/x",
      author: "Anton: with colon",
      version: "1.0.0",
    });

    expect(result).toContain('author: "Anton: with colon"');
  });

  it("YAML-escapes forkedFrom value containing special characters", () => {
    const content = [
      "---",
      "name: x",
      "description: d",
      "---",
      "body",
    ].join("\n");

    const result = applyForkMetadata(content, {
      name: "anton/x",
      author: "Anton",
      version: "1.0.0",
      forkedFrom: "weird:source",
    });

    expect(result).toContain('forkedFrom: "weird:source"');
  });
});

// ---------------------------------------------------------------------------

describe("applyForkMetadata — malformed frontmatter", () => {
  it("throws when there is no frontmatter at all", () => {
    const content = "# Just a heading\n\nNo frontmatter here.";

    expect(() =>
      applyForkMetadata(content, {
        name: "anton/x",
        author: "Anton",
        version: "1.0.0",
      }),
    ).toThrow(/missing a YAML frontmatter block/);
  });

  it("throws when the frontmatter is not closed", () => {
    const content = "---\nname: x\nbroken: [unclosed\n# body without closing dashes";

    expect(() =>
      applyForkMetadata(content, {
        name: "anton/x",
        author: "Anton",
        version: "1.0.0",
      }),
    ).toThrow(/missing a YAML frontmatter block/);
  });

  it("throws on empty input rather than silently corrupting", () => {
    expect(() =>
      applyForkMetadata("", {
        name: "anton/x",
        author: "Anton",
        version: "1.0.0",
      }),
    ).toThrow(/missing a YAML frontmatter block/);
  });
});

// ---------------------------------------------------------------------------

describe("applyForkMetadata — body preservation", () => {
  it("does not touch the body content beyond the closing ---", () => {
    const body = [
      "# Title",
      "",
      "Some prose with `sw:foo` reference.",
      "",
      "```ts",
      "code block content",
      "```",
      "",
      "More prose.",
      "",
    ].join("\n");

    const content = `---\nname: sw/x\ndescription: d\nauthor: A\nversion: 2.0.0\n---\n${body}`;

    const result = applyForkMetadata(content, {
      name: "anton/x",
      author: "Anton",
      version: "1.0.0",
    });

    expect(result.endsWith(body)).toBe(true);
  });

  it("normalizes CRLF line endings while preserving body content", () => {
    const content =
      "---\r\nname: sw/x\r\ndescription: d\r\nauthor: A\r\nversion: 2.0.0\r\n---\r\n# Body\r\nLine two";

    const result = applyForkMetadata(content, {
      name: "anton/x",
      author: "Anton",
      version: "1.0.0",
    });

    expect(result).not.toContain("\r");
    expect(result).toContain("# Body");
    expect(result).toContain("Line two");
  });
});
