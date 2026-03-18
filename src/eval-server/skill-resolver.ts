// ---------------------------------------------------------------------------
// skill-resolver.ts -- shared skill directory resolution
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";

function assertContained(candidate: string, root: string): void {
  const resolved = resolve(candidate);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error("Invalid skill path: directory traversal detected");
  }
}

export function resolveSkillDir(root: string, plugin: string, skill: string): string {
  // Layout 4 (self): root IS the skill directory (has SKILL.md)
  if (basename(root) === skill && existsSync(join(root, "SKILL.md"))) return root;

  // Try direct layout: {root}/{plugin}/skills/{skill}/
  const directPath = join(root, plugin, "skills", skill);
  assertContained(directPath, root);
  if (existsSync(directPath)) return directPath;

  // Try nested plugins/ layout: {root}/plugins/{plugin}/skills/{skill}/
  const nestedPath = join(root, "plugins", plugin, "skills", skill);
  assertContained(nestedPath, root);
  if (existsSync(nestedPath)) return nestedPath;

  // Try root layout: {root}/skills/{skill}/
  const rootPath = join(root, "skills", skill);
  assertContained(rootPath, root);
  if (existsSync(rootPath)) return rootPath;

  // Try flat layout: {root}/{skill}/ (skills as direct children)
  const flatPath = join(root, skill);
  assertContained(flatPath, root);
  if (existsSync(join(flatPath, "SKILL.md"))) return flatPath;

  return directPath;
}
