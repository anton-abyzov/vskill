import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { getProjectRoot } from "./project-root.js";

/**
 * A nested installation owns its own lockfile even inside a SpecWeave umbrella.
 * Stop at that ownership boundary, including an unreadable/malformed lockfile;
 * falling through to an ancestor could delete another project's installation.
 * Without a nested lock, preserve SpecWeave's existing project-root behavior.
 */
export function resolveLocalSkillRoot(): string {
  const boundary = resolve(getProjectRoot());
  let current = resolve(process.cwd());
  const within = relative(boundary, current);
  if (within.startsWith(`..${sep}`) || within === ".." || isAbsolute(within)) {
    return boundary;
  }
  while (true) {
    if (existsSync(join(current, "vskill.lock"))) return current;
    if (current === boundary) return boundary;
    current = dirname(current);
  }
}
