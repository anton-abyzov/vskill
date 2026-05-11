// 0845 T-009 — Junie transformer (Tier 2). Plain markdown at rules/<name>.md.
// AC-US4-06.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const junieTransformer: FormatTransformer = (skill): TransformedFile[] => [
  { relativePath: `rules/${skill.name}.md`, content: skill.body },
];
