// ---------------------------------------------------------------------------
// 0740 disk-version — read SKILL.md frontmatter version from disk
// ---------------------------------------------------------------------------
// CONTRACT (do not regress):
//   `vskill outdated --json` was reading `currentVersion` from `vskill.lock`.
//   When the user edits SKILL.md in place (without `vskill update`), the
//   lockfile drifts: lockfile says 1.0.0 but the file on disk says 1.3.0.
//   The bell/toast then displayed `1.0.0 → 1.0.6` while the sidebar showed
//   1.3.0 from the same file. This helper resolves a SKILL.md path on disk
//   and returns its frontmatter version, so callers can prefer disk truth.
//
//   Frontmatter formats supported (preference order):
//     1. Top-level `version: 1.2.3`
//     2. Nested `metadata:\n  version: 1.2.3`
//   Top-level wins when both are present.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SkillLockEntry } from "../lockfile/types.js";

/**
 * Read the version string from a SKILL.md frontmatter block. Returns null
 * when the file is missing, has no frontmatter, or no `version` field at
 * any supported location.
 */
export function readDiskVersion(skillMdPath: string): string | null {
  if (!existsSync(skillMdPath)) return null;
  let content: string;
  try {
    content = readFileSync(skillMdPath, "utf8");
  } catch {
    return null;
  }
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  // 1. Top-level `version:` (highest priority)
  const topLevel = fm.match(/^version\s*:\s*(.+)$/m);
  if (topLevel) {
    const v = stripQuotes(topLevel[1].trim());
    if (v) return v;
  }

  // 2. Nested under `metadata:` block — look for the metadata block then
  //    a `  version:` line within it (2+ space indent).
  const metaIdx = fm.search(/^metadata\s*:\s*$/m);
  if (metaIdx >= 0) {
    const after = fm.slice(metaIdx);
    const nested = after.match(/^[ \t]+version\s*:\s*(.+)$/m);
    if (nested) {
      const v = stripQuotes(nested[1].trim());
      if (v) return v;
    }
  }

  return null;
}

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, "").trim();
}

export interface ReconcileResult {
  version: string;
  warning?: string;
}

/**
 * Returns the version that should be reported as `currentVersion` to the
 * platform's `/check-updates` API. Prefers disk frontmatter; falls back to
 * the lockfile-pinned version with a warning when disk is unreadable.
 */
export function reconcileLockfileVersion(args: {
  lockfileVersion: string;
  skillMdPath: string;
}): ReconcileResult {
  const disk = readDiskVersion(args.skillMdPath);
  if (disk) return { version: disk };
  return {
    version: args.lockfileVersion,
    warning: `disk version unreadable at ${args.skillMdPath}; using lockfile pin`,
  };
}

/**
 * Resolve the on-disk SKILL.md path for a given lockfile entry. Returns the
 * conventional path; the file may or may not exist (callers handle the
 * fallback via reconcileLockfileVersion).
 *
 * Resolution order:
 *   1. `entry.installedPath` (if set, append SKILL.md when not already a file)
 *   2. user scope → `~/.claude/skills/<name>/SKILL.md`
 *   3. project scope (default) → `<lockDir>/.claude/skills/<name>/SKILL.md`
 */
export function resolveInstallPath(args: {
  name: string;
  entry: SkillLockEntry;
  lockDir: string;
}): string {
  const { name, entry, lockDir } = args;
  if (entry.installedPath) {
    if (entry.installedPath.endsWith("SKILL.md")) return entry.installedPath;
    return join(entry.installedPath, "SKILL.md");
  }
  // The entry name may be a hierarchical "owner/repo/skill" — use only the
  // last segment as the on-disk dir name.
  const leaf = name.split("/").pop() ?? name;
  if (entry.scope === "user") {
    return join(homedir(), ".claude", "skills", leaf, "SKILL.md");
  }
  return join(lockDir, ".claude", "skills", leaf, "SKILL.md");
}

/**
 * Compare two semver strings. Returns negative if a < b, positive if a > b,
 * zero if equal. Falls back to localeCompare for non-numeric versions.
 */
export function compareSemver(a: string, b: string): number {
  const re = /^(\d+)\.(\d+)\.(\d+)/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (!ma || !mb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const da = parseInt(ma[i], 10);
    const db = parseInt(mb[i], 10);
    if (da !== db) return da - db;
  }
  return 0;
}
