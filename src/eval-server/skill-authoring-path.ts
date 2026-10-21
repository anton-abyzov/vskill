import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveSkillDir } from "./skill-resolver.js";

type AuthoringLayout = 1 | 2 | 3;
export class AuthoringPathError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function computeSkillDir(root: string, layout: AuthoringLayout, plugin: string, name: string): string {
  switch (layout) {
    case 1: return join(root, plugin, "skills", name);
    case 2: return join(root, "plugins", plugin, "skills", name);
    case 3: return join(root, "skills", name);
  }
}

/** The load and update endpoints share both layout and real filesystem checks.
 * Check before reading provenance, and again before writing: a prior successful
 * GET is not authorization to follow a path that has since moved outside. */
export function resolveAuthoringSkillPath(root: string, plugin: string, skill: string, requestedLayout?: AuthoringLayout) {
  const dir = requestedLayout ? computeSkillDir(root, requestedLayout, plugin, skill) : resolveSkillDir(root, plugin, skill);
  const layout = requestedLayout ?? ([1, 2, 3] as const).find((candidate) =>
    resolve(computeSkillDir(root, candidate, plugin, skill)) === resolve(dir));
  if (!layout) throw new AuthoringPathError("Only workspace-authored skills can be updated here", 403);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) throw new AuthoringPathError("Skill to update was not found", 404);
  const realRoot = realpathSync.native(root);
  for (const target of [dir, file]) {
    const location = relative(realRoot, realpathSync.native(target));
    if (!location || location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
      throw new AuthoringPathError("Only workspace-authored skills can be updated here", 403);
    }
  }
  return { dir, file, layout };
}
