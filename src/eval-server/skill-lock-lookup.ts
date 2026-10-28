// ---------------------------------------------------------------------------
// skill-lock-lookup.ts -- find an installed skill's vskill.lock entry for the
// Studio root, the same way the CLI resolves locks (project lock first, then
// ~/.agents/vskill.lock, then the legacy ~/vskill.lock).
//
// 1126: update, pin and install-version routes need the lock key (bare leaf
// name), the lock's scope (to pass --global), and the full owner/repo/skill
// name (for `vskill install owner/repo/skill@X`). Studio rows and the Updates
// list carry either the leaf or the full name, so both are accepted.
// ---------------------------------------------------------------------------

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readLockfile, writeLockfile } from "../lockfile/lockfile.js";
import { parseSource } from "../resolvers/source-resolver.js";
import type { SkillLockEntry, VskillLock } from "../lockfile/types.js";

export type LockScope = "project" | "global";

export interface SkillLockMatch {
  /** Key in lock.skills (what `vskill update/pin` expects). */
  lockName: string;
  entry: SkillLockEntry;
  lock: VskillLock;
  /** Directory holding the vskill.lock this entry came from. */
  dir: string;
  scope: LockScope;
  /** owner/repo/skill when the source is a public-style GitHub source. */
  fullName: string | null;
}

/** owner/repo/skill for a lock entry, or null when its source has none. */
export function fullNameForEntry(lockName: string, entry: SkillLockEntry): string | null {
  if (lockName.split("/").length === 3) return lockName;
  let parsed: ReturnType<typeof parseSource> | undefined;
  try {
    parsed = parseSource(entry.source ?? "");
  } catch {
    parsed = undefined;
  }
  if (
    parsed &&
    (parsed.type === "github" || parsed.type === "github-plugin" || parsed.type === "marketplace")
  ) {
    return `${parsed.owner}/${parsed.repo}/${lockName}`;
  }
  return null;
}

function candidatesFor(name: string): string[] {
  const leaf = name.split("/").pop() ?? name;
  return leaf && leaf !== name ? [name, leaf] : [name];
}

function lockDirs(root: string, home: string): Array<{ dir: string; scope: LockScope }> {
  const dirs: Array<{ dir: string; scope: LockScope }> = [];
  const r = resolve(root);
  const h = resolve(home);
  // $HOME is never a project: its vskill.lock is the legacy global lock.
  if (r !== h && r !== join(h, ".agents")) dirs.push({ dir: r, scope: "project" });
  dirs.push({ dir: join(h, ".agents"), scope: "global" });
  dirs.push({ dir: h, scope: "global" });
  return dirs;
}

/**
 * Find `name` (leaf or owner/repo/skill) in the locks the CLI would read
 * from `root`. Returns null when no lock records it.
 */
export function findSkillLockEntry(
  root: string,
  name: string,
  home: string = homedir(),
): SkillLockMatch | null {
  const candidates = candidatesFor(name);
  for (const { dir, scope } of lockDirs(root, home)) {
    let lock: VskillLock | null | undefined;
    try {
      lock = readLockfile(dir);
    } catch {
      lock = null;
    }
    if (!lock || !lock.skills) continue;
    for (const c of candidates) {
      const entry = lock.skills[c];
      if (entry) {
        return { lockName: c, entry, lock, dir, scope, fullName: fullNameForEntry(c, entry) };
      }
    }
  }
  return null;
}

/** Set or clear the pin on a matched entry and write its lock back. */
export function writePin(match: SkillLockMatch, pinnedVersion: string | null): void {
  const entry = match.lock.skills[match.lockName];
  if (!entry) return;
  if (pinnedVersion) entry.pinnedVersion = pinnedVersion;
  else delete entry.pinnedVersion;
  writeLockfile(match.lock, match.dir);
}
