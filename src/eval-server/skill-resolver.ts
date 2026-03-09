// ---------------------------------------------------------------------------
// skill-resolver.ts -- shared skill directory resolution
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join, basename } from "node:path";

export function resolveSkillDir(root: string, plugin: string, skill: string): string {
  // Layout 4 (self): root IS the skill directory (has SKILL.md)
  if (basename(root) === skill && existsSync(join(root, "SKILL.md"))) return root;

  // Try direct layout: {root}/{plugin}/skills/{skill}/
  const directPath = join(root, plugin, "skills", skill);
  if (existsSync(directPath)) return directPath;

  // Try nested plugins/ layout: {root}/plugins/{plugin}/skills/{skill}/
  const nestedPath = join(root, "plugins", plugin, "skills", skill);
  if (existsSync(nestedPath)) return nestedPath;

  // Try root layout: {root}/skills/{skill}/
  const rootPath = join(root, "skills", skill);
  if (existsSync(rootPath)) return rootPath;

  return directPath;
}
