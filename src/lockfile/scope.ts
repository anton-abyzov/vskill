// ---------------------------------------------------------------------------
// Which vskill.lock a command works on: the project's or the user-level one.
//
// Project installs keep their lock in the project root; `--global` installs
// keep theirs in ~/.agents/vskill.lock (older releases wrote ~/vskill.lock).
// `update`, `outdated` and `list` used to read only the project lock, so
// user-level installs never updated. Rules:
//
//   --global                      -> ~/.agents/vskill.lock (+ legacy ~/vskill.lock)
//   a project lock is found       -> that lock
//   inside a SpecWeave project    -> project scope, no lock (the caller says so)
//   anywhere else (incl. $HOME)   -> the global lock, flagged as a fallback
//
// The lock reader is passed in so command tests that mock the lockfile
// module keep controlling what is read.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import type { VskillLock } from "./types.js";
import { getProjectRoot } from "./project-root.js";
import { resolveLocalSkillRoot } from "./local-root.js";

export type LockScope = "project" | "global";

export interface LockTarget {
  scope: LockScope;
  /** Directory holding vskill.lock (and, for project scope, the install root). */
  dir: string;
  lock: VskillLock;
  /** ~/vskill.lock written by older global installs. */
  legacy?: boolean;
  /** Entries this target owns. A legacy entry also present in the current
   *  global lock is left to the current lock. */
  names: string[];
}

export interface LockResolution {
  scope: LockScope;
  /** Empty when no lockfile was found for the scope. */
  targets: LockTarget[];
  /** No project lock here, so the global lock was used without --global. */
  fellBackToGlobal: boolean;
  /** Project directory the lookup started from. */
  projectDir: string;
  /** Lockfile path to show in messages for this scope. */
  displayPath: string;
}

export interface ResolveLockOptions {
  global?: boolean;
  read: (dir: string) => VskillLock | null;
  /** Test seam — defaults to os.homedir(). */
  home?: string;
}

/** Directory of the current global lock (~/.agents). */
export function globalLockDir(home: string = os.homedir()): string {
  return join(home, ".agents");
}

function isSpecweaveProject(dir: string): boolean {
  try {
    return existsSync(join(dir, ".specweave", "config.json"));
  } catch {
    return false;
  }
}

/** The global lock targets: ~/.agents/vskill.lock, then entries only the
 *  legacy ~/vskill.lock still records. */
export function globalLockTargets(
  read: (dir: string) => VskillLock | null,
  home: string = os.homedir(),
): LockTarget[] {
  const targets: LockTarget[] = [];
  const primaryDir = globalLockDir(home);
  const primary = read(primaryDir);
  if (primary) {
    targets.push({ scope: "global", dir: primaryDir, lock: primary, names: Object.keys(primary.skills ?? {}) });
  }
  const legacy = read(home);
  if (legacy && legacy !== primary) {
    const names = Object.keys(legacy.skills ?? {}).filter((n) => !primary?.skills?.[n]);
    if (names.length > 0) {
      targets.push({ scope: "global", dir: home, lock: legacy, legacy: true, names });
    }
  }
  return targets;
}

export function resolveLockTargets(opts: ResolveLockOptions): LockResolution {
  const home = resolve(opts.home ?? os.homedir());
  const globalDisplay = join(globalLockDir(home), "vskill.lock");
  const projectDir = resolveLocalSkillRoot();
  const forGlobal = (fellBackToGlobal: boolean): LockResolution => ({
    scope: "global",
    targets: globalLockTargets(opts.read, home),
    fellBackToGlobal,
    projectDir,
    displayPath: globalDisplay,
  });

  if (opts.global) return forGlobal(false);

  // $HOME is not a project: its vskill.lock is the legacy global lock, and
  // ~/.agents holds the current one.
  const atHome = resolve(projectDir) === home || resolve(projectDir) === globalLockDir(home);
  if (!atHome) {
    const lock = opts.read(projectDir);
    if (lock) {
      return {
        scope: "project",
        targets: [{ scope: "project", dir: projectDir, lock, names: Object.keys(lock.skills ?? {}) }],
        fellBackToGlobal: false,
        projectDir,
        displayPath: join(projectDir, "vskill.lock"),
      };
    }
    if (isSpecweaveProject(projectDir) || isSpecweaveProject(getProjectRoot())) {
      return {
        scope: "project",
        targets: [],
        fellBackToGlobal: false,
        projectDir,
        displayPath: join(projectDir, "vskill.lock"),
      };
    }
  }
  return forGlobal(true);
}

/** Every entry across the targets, first target winning on a name clash. */
export function mergedSkills(targets: LockTarget[]): VskillLock["skills"] {
  const out: VskillLock["skills"] = {};
  for (const t of targets) {
    for (const name of t.names) {
      if (!(name in out)) out[name] = t.lock.skills[name];
    }
  }
  return out;
}
