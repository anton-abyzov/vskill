// 0845 T-008 — GitHub Copilot (VS Code) transformer unit tests.
// Contract (plan.md §6, AC-US4-05): relativePath =
// "instructions/<name>.instructions.md"; frontmatter `applyTo: "**"`;
// body verbatim. Idempotent.

import { describe, it, expect } from "vitest";
import { githubCopilotTransformer } from "../github-copilot.js";
import type { ParsedSkill } from "../index.js";

const skill: ParsedSkill = {
  name: "obsidian-brain",
  description: "PARA + LLM Wiki",
  body: "## Body\n\nLorem ipsum.\n",
  originalFrontmatter: "name: obsidian-brain",
};

describe("githubCopilotTransformer", () => {
  it("emits one file at instructions/<name>.instructions.md", () => {
    const out = githubCopilotTransformer(skill);
    expect(out).toHaveLength(1);
    expect(out[0].relativePath).toBe("instructions/obsidian-brain.instructions.md");
  });

  it("frontmatter contains applyTo: \"**\"", () => {
    const [{ content }] = githubCopilotTransformer(skill);
    expect(content.startsWith(`---\napplyTo: "**"\n---\n`)).toBe(true);
  });

  it("body follows frontmatter verbatim", () => {
    const [{ content }] = githubCopilotTransformer(skill);
    expect(content.endsWith(skill.body)).toBe(true);
    expect(content.match(/^---\n/gm)?.length).toBe(2);
  });

  it("is idempotent — byte-equal on re-invocation", () => {
    expect(githubCopilotTransformer(skill)).toEqual(githubCopilotTransformer(skill));
  });
});
