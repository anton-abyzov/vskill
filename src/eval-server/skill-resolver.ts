// ---------------------------------------------------------------------------
// skill-resolver.ts -- shared skill directory resolution
//
// 0769 T-006: adds resolveAllowedSkillDir() — a registry-aware variant that
// supports skills whose directory lives OUTSIDE the studio root (e.g. plugin-
// cache snapshots at ~/.claude/plugins/cache/...) while still preventing path
// traversal via an explicit allowlist of root prefixes.
// ---------------------------------------------------------------------------

import { existsSync, realpathSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { getSkillDirEntry } from "./skill-dir-registry.js";

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

/**
 * 0769 T-006: registry-aware skill directory resolver with explicit allowlist.
 *
 * - If the registry has an entry for (plugin, skill), validate its `dir`
 *   against `allowedRoots` (after path.resolve normalization, plus a
 *   realpath check to defeat symlink escapes) and return it.
 * - Otherwise fall back to the root-based `resolveSkillDir()`.
 *
 * Allowlist matching is prefix-based: a candidate is accepted iff its
 * resolved path starts with the resolved form of at least one allowed root.
 * Inputs containing '..' or symlinks whose realpath escapes the allowlist
 * are rejected with an informative error.
 */
export function resolveAllowedSkillDir(
  root: string,
  plugin: string,
  skill: string,
  allowedRoots: string[],
): string {
  const entry = getSkillDirEntry(plugin, skill);
  if (entry) {
    return validateAgainstAllowlist(entry.dir, allowedRoots);
  }
  return resolveSkillDir(root, plugin, skill);
}

function validateAgainstAllowlist(candidate: string, allowedRoots: string[]): string {
  // 0769 F-001: segment-based traversal check — `includes("..")` is too coarse
  // and would also reject legitimate paths whose filename contains a literal
  // ".." substring (e.g. "a..b"). Reject only when ".." appears as a path
  // SEGMENT separator-bounded.
  const segments = candidate.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    throw new Error(`Invalid skill path: directory traversal detected in "${candidate}"`);
  }
  const resolved = resolve(candidate);
  // Normalize roots both logically (path.resolve) AND via realpath so symlink-
  // backed temp dirs (e.g. macOS /tmp -> /private/tmp) match in both directions.
  const logicalRoots = allowedRoots.map((r) => resolve(r));
  const realRoots = logicalRoots.map((r) => safeRealpath(r));

  const fitsLogically =
    logicalRoots.some((r) => resolved.startsWith(r)) ||
    realRoots.some((r) => resolved.startsWith(r));
  if (!fitsLogically) {
    throw new Error(`Invalid skill path: "${resolved}" is outside allowlist`);
  }

  // Defeat symlink escape: the realpath must also remain inside the allowlist.
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    // The path may not exist yet (route handler will then return 404). Fall
    // back to the logical-path check above when realpath fails.
    return resolved;
  }
  const fitsReal =
    logicalRoots.some((r) => real.startsWith(r)) ||
    realRoots.some((r) => real.startsWith(r));
  if (!fitsReal) {
    throw new Error(`Invalid skill path: realpath "${real}" is outside allowlist`);
  }
  return resolved;
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
