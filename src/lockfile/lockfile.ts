// ---------------------------------------------------------------------------
// Read/write vskill.lock
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { VskillLock, SkillLockEntry } from "./types.js";
import { getProjectRoot } from "./project-root.js";

const LOCKFILE_NAME = "vskill.lock";
const SKILLS_SH_LOCKFILE = ".skill-lock.json";

function lockPath(dir?: string): string {
  return join(dir ?? getProjectRoot(), LOCKFILE_NAME);
}

/**
 * Read vskill.lock from cwd or specified directory.
 * Returns null if the lockfile does not exist.
 */
export function readLockfile(dir?: string): VskillLock | null {
  const p = lockPath(dir);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as VskillLock;
  } catch {
    return null;
  }
}

/**
 * Write a VskillLock object to disk.
 */
export function writeLockfile(lock: VskillLock, dir?: string): void {
  lock.updatedAt = new Date().toISOString();
  const p = lockPath(dir);
  writeFileSync(p, JSON.stringify(lock, null, 2) + "\n", "utf-8");
}

/**
 * Create a lockfile if one does not already exist.
 * Returns the existing or newly created lock.
 */
export function ensureLockfile(dir?: string): VskillLock {
  const existing = readLockfile(dir);
  if (existing) return existing;

  const lock: VskillLock = {
    version: 1,
    agents: [],
    skills: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeLockfile(lock, dir);
  return lock;
}

/**
 * Add or update a skill entry in the lockfile.
 */
export function addSkillToLock(
  name: string,
  info: SkillLockEntry,
  dir?: string
): void {
  const lock = ensureLockfile(dir);
  lock.skills[name] = info;
  writeLockfile(lock, dir);
}

/**
 * Read .skill-lock.json (skills.sh lock file) for cross-tool visibility.
 * Returns skill names found, or empty array if file doesn't exist.
 */
export function readSkillsShLock(dir?: string): { name: string; source: string }[] {
  const p = join(dir ?? getProjectRoot(), SKILLS_SH_LOCKFILE);
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw);
    // skills.sh lock format: { skills: { "name": { ... } } } or array-based
    if (data && typeof data === "object" && data.skills) {
      return Object.keys(data.skills).map((name) => ({
        name,
        source: "skills.sh",
      }));
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Remove a skill entry from the lockfile.
 */
export function removeSkillFromLock(name: string, dir?: string): void {
  const lock = readLockfile(dir);
  if (!lock) return;
  delete lock.skills[name];
  writeLockfile(lock, dir);
}
