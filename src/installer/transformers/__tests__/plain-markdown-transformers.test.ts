// 0845 T-009 — Plain-markdown transformers (Junie, Kiro, Continue.dev, Trae).
//
// All four strip frontmatter and emit body verbatim; they differ only in
// the subfolder layout per AC-US4-06.
//
//   junie         → rules/<name>.md
//   kiro-cli      → steering/<name>.md
//   continue      → rules/<name>.md
//   trae          → <name>.md (no subdir)

import { describe, it, expect } from "vitest";
import { junieTransformer } from "../junie.js";
import { kiroTransformer } from "../kiro.js";
import { continueDevTransformer } from "../continue-dev.js";
import { traeTransformer } from "../trae.js";
import type { FormatTransformer, ParsedSkill } from "../index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Body heading\n\nPlain text body.\n",
  originalFrontmatter: "name: obsidian-brain\ndescription: PARA + LLM Wiki",
};

const cases: Array<{
  name: string;
  fn: FormatTransformer;
  expectedPath: string;
}> = [
  { name: "junie", fn: junieTransformer, expectedPath: "rules/obsidian-brain.md" },
  { name: "kiro-cli", fn: kiroTransformer, expectedPath: "steering/obsidian-brain.md" },
  { name: "continue", fn: continueDevTransformer, expectedPath: "rules/obsidian-brain.md" },
  { name: "trae", fn: traeTransformer, expectedPath: "obsidian-brain.md" },
];

describe.each(cases)("$name transformer", ({ fn, expectedPath }) => {
  it(`emits exactly one file at ${expectedPath}`, () => {
    const out = fn(skill);
    expect(out).toHaveLength(1);
    expect(out[0].relativePath).toBe(expectedPath);
  });

  it("emits plain markdown — no frontmatter block", () => {
    const [{ content }] = fn(skill);
    expect(content.startsWith("---")).toBe(false);
    expect(content).not.toMatch(/^---\n/m);
  });

  it("preserves body verbatim", () => {
    const [{ content }] = fn(skill);
    expect(content).toBe(skill.body);
  });

  it("is idempotent — byte-equal on re-invocation", () => {
    expect(fn(skill)).toEqual(fn(skill));
  });
});
