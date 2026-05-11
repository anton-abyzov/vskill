// 0845 T-007 — Windsurf transformer (Tier 2).
// Windsurf consumes plain markdown rule files under `.windsurf/rules/<name>.md`.
// AC-US4-04: frontmatter stripped, body verbatim.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const windsurfTransformer: FormatTransformer = (skill): TransformedFile[] => {
  return [
    {
      relativePath: `rules/${skill.name}.md`,
      content: skill.body,
    },
  ];
};
