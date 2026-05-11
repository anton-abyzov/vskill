// 0845 T-009 — Kiro transformer (Tier 2). Plain markdown at steering/<name>.md.
// AC-US4-06.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const kiroTransformer: FormatTransformer = (skill): TransformedFile[] => [
  { relativePath: `steering/${skill.name}.md`, content: skill.body },
];
