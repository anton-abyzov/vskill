// 0845 T-010 — Aider transformer (Tier 2).
//
// Aider expects "conventions" files referenced from `~/.aider.conf.yml`'s
// `read:` list. The transformer is pure — it emits two TransformedFiles:
//
//   1. conventions/<name>.md    op:"write"    body verbatim
//   2. ../../.aider.conf.yml    op:"append-yaml-list"  key=read  value=~/.aider/conventions/<name>.md
//
// The dispatcher in multi-install.ts handles the conf.yml side effect
// through safeAppendYamlList() per ADR-0845-03 — backup-write, idempotent
// append, malformed-input rejection.
//
// The conf.yml relativePath ascends ONE level: the Aider install root is
// `~/.aider` (the parent of `~/.aider/skills`), so `../` from there lands
// at `$HOME` where `.aider.conf.yml` lives. For project scope the same
// ascent lands at the project root, where Aider also looks for
// `.aider.conf.yml` — so the `read:` value must be project-relative
// (`.aider/conventions/...`), not a `~/` path that was never written.

import type { FormatTransformer, TransformedFile } from "./index.js";

export const aiderTransformer: FormatTransformer = (skill, scope): TransformedFile[] => {
  const conventionsRef =
    scope === "project"
      ? `.aider/conventions/${skill.name}.md`
      : `~/.aider/conventions/${skill.name}.md`;
  return [
    {
      relativePath: `conventions/${skill.name}.md`,
      content: skill.body,
      op: "write",
    },
    {
      relativePath: "../.aider.conf.yml",
      content: "",
      op: "append-yaml-list",
      yamlListKey: "read",
      yamlListValue: conventionsRef,
    },
  ];
};
