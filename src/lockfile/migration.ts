// ---------------------------------------------------------------------------
// Lockfile migration — normalize legacy entries on read
// ---------------------------------------------------------------------------

import type { SkillLockEntry, VskillLock } from "./types.js";

/**
 * Migrate a single lock entry.
 * - Replaces empty or "0.0.0" versions with "1.0.0".
 * - Returns a new object (no mutation).
 */
export function migrateLockEntry(entry: SkillLockEntry): SkillLockEntry {
  const version =
    !entry.version || entry.version === "0.0.0" ? "1.0.0" : entry.version;
  return { ...entry, version };
}

/**
 * Migrate an entire lockfile, applying migrateLockEntry to every skill.
 * Returns a new VskillLock (no mutation).
 */
export function migrateLock(lock: VskillLock): VskillLock {
  const skills: Record<string, SkillLockEntry> = {};
  for (const [name, entry] of Object.entries(lock.skills)) {
    skills[name] = migrateLockEntry(entry);
  }
  return { ...lock, skills };
}
