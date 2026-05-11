// 0845 T-010 — Aider transformer unit tests.
//
// Pure-function contract (no I/O). The transformer emits TWO TransformedFiles:
//   1. conventions/<name>.md      → op:"write", plain markdown body
//   2. ../../.aider.conf.yml      → op:"append-yaml-list", key:"read",
//                                   value:"~/.aider/conventions/<name>.md"
//
// The dispatcher in multi-install.ts is responsible for resolving the
// tilde + applying safeAppendYamlList; this test only asserts the contract
// the transformer hands off.

import { describe, it, expect } from "vitest";
import { aiderTransformer } from "../aider.js";
import type { ParsedSkill } from "../index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Conventions\n\nAlways do X.\n",
  originalFrontmatter: "name: obsidian-brain",
};

describe("aiderTransformer", () => {
  it("emits exactly two TransformedFiles", () => {
    expect(aiderTransformer(skill)).toHaveLength(2);
  });

  it("first file is conventions/<name>.md with plain-markdown body", () => {
    const [conv] = aiderTransformer(skill);
    expect(conv.relativePath).toBe("conventions/obsidian-brain.md");
    expect(conv.content).toBe(skill.body);
    expect(conv.op === undefined || conv.op === "write").toBe(true);
  });

  it("second file targets ~/.aider.conf.yml with append-yaml-list op", () => {
    const [, conf] = aiderTransformer(skill);
    // Install root is ~/.aider; ../ from there lands at $HOME where
    // .aider.conf.yml lives. Just ONE `..`, not two.
    expect(conf.relativePath).toBe("../.aider.conf.yml");
    expect(conf.op).toBe("append-yaml-list");
    expect(conf.yamlListKey).toBe("read");
    expect(conf.yamlListValue).toBe("~/.aider/conventions/obsidian-brain.md");
    // The content field is unused for append ops; defensive empty string.
    expect(conf.content).toBe("");
  });

  it("is idempotent — byte-equal on re-invocation", () => {
    expect(aiderTransformer(skill)).toEqual(aiderTransformer(skill));
  });
});
