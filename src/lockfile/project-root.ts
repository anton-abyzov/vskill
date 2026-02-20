import { existsSync, statSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

/**
 * Walk up from startDir looking for .specweave/config.json.
 * Mirrors the shell hook's SW_PROJECT_ROOT walk-up logic.
 *
 * @returns Project root path or null if not found.
 */
export function findProjectRoot(startDir?: string): string | null {
  let current = resolve(startDir ?? process.cwd());
  const root = parse(current).root;

  while (current !== root) {
    const specweavePath = join(current, ".specweave");
    if (
      existsSync(specweavePath) &&
      statSync(specweavePath).isDirectory() &&
      existsSync(join(specweavePath, "config.json"))
    ) {
      return current;
    }
    current = dirname(current);
  }

  return null;
}

/**
 * Returns findProjectRoot() or process.cwd() as fallback.
 */
export function getProjectRoot(startDir?: string): string {
  return findProjectRoot(startDir) ?? process.cwd();
}
