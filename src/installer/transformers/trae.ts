// 0845 T-009 — Trae transformer (Tier 2). Plain markdown at top-level <name>.md
// (Trae's install root holds rules directly — no subdir). AC-US4-06.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const traeTransformer: FormatTransformer = (skill): TransformedFile[] => [
  { relativePath: `${skill.name}.md`, content: skill.body },
];
