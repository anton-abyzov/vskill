// 0845 T-008 — GitHub Copilot (VS Code extension) transformer (Tier 2).
//
// Copilot's "custom instructions" mechanism reads from
// `.github/instructions/<name>.instructions.md`. The project-scope install
// root is pinned to `.github` via the registry's `localInstallRoot`
// override (F7) — NOT derived from localSkillsDir — so the relative
// `instructions/...` path below lands where VS Code actually reads.
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
