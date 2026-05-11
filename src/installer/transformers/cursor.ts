// 0845 T-006 — Cursor transformer (Tier 2).
//
// Cursor consumes "rules" files at `.cursor/rules/<name>.mdc`. The frontmatter
// shape — `description`, `globs: ""`, `alwaysApply: false` — places the rule
// in Cursor's "agent-requested" mode: Cursor loads it only when its description
// matches the conversation. This mirrors Claude Code's auto-trigger semantics
// best, though Cursor's selection logic is opaque to us (plan.md §8 R2).
//
// AC-US4-03: relativePath = "rules/<name>.mdc"; frontmatter starts with
// `---\ndescription: <desc>\nglobs: ""\nalwaysApply: false\n---`; body follows
// verbatim. Idempotent (same input → byte-equal output).

import type { FormatTransformer, TransformedFile } from "./index.js";
import { quoteYAMLValue } from "../frontmatter.js";

export const cursorTransformer: FormatTransformer = (skill): TransformedFile[] => {
  const description = quoteYAMLValue(skill.description);
  const frontmatter =
    `---\ndescription: ${description}\nglobs: ""\nalwaysApply: false\n---\n`;
  const content = frontmatter + skill.body;
  return [
    {
      relativePath: `rules/${skill.name}.mdc`,
      content,
    },
  ];
};
