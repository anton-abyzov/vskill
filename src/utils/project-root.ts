/**
 * Smart project root resolution.
 *
 * Walks up the directory tree from a starting directory, looking for
 * well-known project markers (`.git`, `package.json`, etc.).
 * Returns the absolute path of the nearest directory that contains
 * any marker, or `null` if none is found.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Markers that indicate a project root directory. */
export const PROJECT_MARKERS = [
  ".git",
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "pom.xml",
  ".specweave",
] as const;

/**
 * Walk up the directory tree from `startDir` and return the absolute
 * path of the first directory that contains any project marker.
 *
 * Returns `null` when the filesystem root is reached without finding
 * any marker.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = resolve(startDir);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(resolve(dir, marker))) {
        return dir;
      }
    }

    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root
      return null;
    }
    dir = parent;
  }
}
