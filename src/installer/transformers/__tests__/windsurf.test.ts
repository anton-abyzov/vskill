// 0845 T-007 — Windsurf transformer unit tests.
// Contract (plan.md §6, AC-US4-04): relativePath = "rules/<name>.md",
// plain markdown (no frontmatter), body verbatim. Idempotent.

import { describe, it, expect } from "vitest";
import { windsurfTransformer } from "../windsurf.js";
import type { ParsedSkill } from "../index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Heading\n\nBody text.\n",
  originalFrontmatter: "name: obsidian-brain",
};

describe("windsurfTransformer", () => {
  it("emits one file at rules/<name>.md", () => {
    const out = windsurfTransformer(skill);
    expect(out).toHaveLength(1);
    expect(out[0].relativePath).toBe("rules/obsidian-brain.md");
  });

  it("emits plain markdown with no YAML frontmatter block", () => {
    const [{ content }] = windsurfTransformer(skill);
    expect(content.startsWith("---")).toBe(false);
    expect(content).not.toMatch(/^---\n/m);
  });

  it("preserves body verbatim", () => {
    const [{ content }] = windsurfTransformer(skill);
    expect(content).toBe(skill.body);
  });

  it("is idempotent — byte-equal across re-invocations", () => {
    expect(windsurfTransformer(skill)).toEqual(windsurfTransformer(skill));
  });
});
