// 0845 T-008 — GitHub Copilot (VS Code extension) transformer (Tier 2).
//
// Copilot's "custom instructions" mechanism reads from
// `.github/instructions/<name>.instructions.md` (the agent's install root
// is the workspace root; the transformer paths are relative to it).
// `applyTo: "**"` makes the instructions apply repo-wide (AC-US4-05).
// A future enhancement could let the user pin specific glob patterns.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const githubCopilotTransformer: FormatTransformer = (skill): TransformedFile[] => {
  const frontmatter = `---\napplyTo: "**"\n---\n`;
  return [
    {
      relativePath: `instructions/${skill.name}.instructions.md`,
      content: frontmatter + skill.body,
    },
  ];
};
