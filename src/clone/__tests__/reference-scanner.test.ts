// ---------------------------------------------------------------------------
// Unit tests for src/clone/reference-scanner.ts (T-011, AC-US1-04).
//
// Verifies the read-only scanner detects:
//   - backtick `sw:foo`
//   - Skill({ skill: "sw:foo" }) and Skill({ skill: 'sw:foo' })
//   - /sw:foo slash-commands
//   - literal occurrences of the old skill name in prose
// And critically that:
//   - matches inside fenced code blocks are suppressed for slash-command + self-name
//   - false positives in compound names (my-ado-mapper-thing) do NOT match self-name
//   - the scanner never modifies its input
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  scanReferences,
  scanSelfNameOccurrences,
} from "../reference-scanner.js";

describe("scanReferences — backtick pattern", () => {
  it("detects single-backtick `sw:foo` references", () => {
    const content = "See the related `sw:foo` and `anton:bar` skills.";
    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });

    const backticks = matches.filter((m) => m.kind === "backtick");
    expect(backticks.map((m) => m.match)).toEqual(["sw:foo", "anton:bar"]);
  });

  it("records 1-indexed line numbers", () => {
    const content = ["intro", "use `sw:foo` here", "outro"].join("\n");
    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });

    expect(matches[0]).toMatchObject({ kind: "backtick", line: 2, match: "sw:foo" });
  });
});

// ---------------------------------------------------------------------------

describe("scanReferences — Skill() call pattern", () => {
  it("detects double-quoted Skill({ skill: \"sw:foo\" }) calls", () => {
    const content = 'Run Skill({ skill: "sw:foo" }) when needed.';
    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });

    const calls = matches.filter((m) => m.kind === "skill-call");
    expect(calls).toHaveLength(1);
    expect(calls[0].match).toBe("sw:foo");
  });

  it("detects single-quoted Skill({ skill: 'sw:foo' }) calls", () => {
    const content = "Run Skill({ skill: 'sw:foo' }) when needed.";
    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });

    const calls = matches.filter((m) => m.kind === "skill-call");
    expect(calls).toHaveLength(1);
    expect(calls[0].match).toBe("sw:foo");
  });

  it("tolerates whitespace variations inside Skill({ ... })", () => {
    const content =
      'Skill({skill:"a:b"}) and Skill( {  skill   :  "c:d" } )';
    const matches = scanReferences(content, { oldSkillName: "x" });

    const calls = matches.filter((m) => m.kind === "skill-call");
    expect(calls.map((c) => c.match)).toEqual(["a:b", "c:d"]);
  });
});

// ---------------------------------------------------------------------------

describe("scanReferences — slash-command pattern", () => {
  it("detects /sw:foo slash-commands in prose", () => {
    const content = "Type /sw:foo to invoke. Also try /anton:bar later.";
    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });

    const slashes = matches.filter((m) => m.kind === "slash-command");
    expect(slashes.map((m) => m.match)).toEqual(["/sw:foo", "/anton:bar"]);
  });

  it("suppresses /sw:foo matches inside fenced code blocks (false-positive guard)", () => {
    const content = [
      "Outside fence: /sw:visible",
      "",
      "```",
      "Inside fence: /sw:hidden",
      "```",
      "",
      "Outside again: /sw:visible-again",
    ].join("\n");

    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });
    const slashes = matches.filter((m) => m.kind === "slash-command");

    expect(slashes.map((m) => m.match)).toEqual(["/sw:visible", "/sw:visible-again"]);
    expect(slashes.map((m) => m.match)).not.toContain("/sw:hidden");
  });
});

// ---------------------------------------------------------------------------

describe("scanReferences — combined output", () => {
  it("returns all three patterns in a single scan", () => {
    const content = [
      "Use `sw:alpha` and call Skill({ skill: \"sw:beta\" }) or run /sw:gamma.",
    ].join("\n");

    const matches = scanReferences(content, { oldSkillName: "ado-mapper" });
    const kinds = matches.map((m) => m.kind);

    expect(kinds).toContain("backtick");
    expect(kinds).toContain("skill-call");
    expect(kinds).toContain("slash-command");
  });

  it("does not modify the input string", () => {
    const original = "`sw:foo` /sw:bar Skill({ skill: 'sw:baz' })";
    const snapshot = original;
    scanReferences(original, { oldSkillName: "x" });
    expect(original).toBe(snapshot);
  });

  it("uses the configured file label in every match", () => {
    const matches = scanReferences("`sw:x`", {
      oldSkillName: "n",
      file: "agents/sub.md",
    });
    expect(matches[0].file).toBe("agents/sub.md");
  });

  it("defaults file label to SKILL.md when not provided", () => {
    const matches = scanReferences("`sw:x`", { oldSkillName: "n" });
    expect(matches[0].file).toBe("SKILL.md");
  });
});

// ---------------------------------------------------------------------------

describe("scanSelfNameOccurrences", () => {
  it("detects literal occurrences of the old skill name in prose", () => {
    const content = "The ado-mapper handles ADO mapping. We rename ado-mapper here.";
    const matches = scanSelfNameOccurrences(content, { oldSkillName: "ado-mapper" });

    expect(matches).toHaveLength(2);
    matches.forEach((m) => expect(m.kind).toBe("self-name"));
  });

  it("does NOT match the bare skill name when it's part of a longer compound word", () => {
    const content = "my-ado-mapper-thing is unrelated, ado-mapperx is also unrelated.";
    const matches = scanSelfNameOccurrences(content, { oldSkillName: "ado-mapper" });

    // Word-boundary guard: hyphen and slash are part of the name "word",
    // so embedded occurrences are suppressed.
    expect(matches).toHaveLength(0);
  });

  it("matches both the namespaced full name and the bare skill segment", () => {
    const content = "Use sw/ado-mapper or ado-mapper directly.";
    const matches = scanSelfNameOccurrences(content, { oldSkillName: "sw/ado-mapper" });

    const matched = matches.map((m) => m.match);
    expect(matched).toContain("sw/ado-mapper");
    expect(matched).toContain("ado-mapper");
  });

  it("suppresses self-name matches inside fenced code blocks", () => {
    const content = [
      "Use ado-mapper here.",
      "",
      "```",
      "ado-mapper inside fence — should be ignored",
      "```",
      "",
      "Another ado-mapper outside.",
    ].join("\n");

    const matches = scanSelfNameOccurrences(content, { oldSkillName: "ado-mapper" });
    expect(matches).toHaveLength(2);
    matches.forEach((m) => expect(m.line).not.toBe(4));
  });
});
