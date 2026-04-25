// ---------------------------------------------------------------------------
// check-dist-freshness.ts — 0728
//
// Compares newest mtime in `src/{eval-server,utils}/` against `dist/{eval-server,utils}/`.
// When src is newer, the running studio is serving compiled code that predates
// the developer's source edits — a confusing failure mode where bug fixes
// "don't apply" because the listening process is loading a stale bundle.
//
// All errors are swallowed; the check is best-effort and never fatal.
// ---------------------------------------------------------------------------

import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";

export interface DistFreshnessResult {
  stale: boolean;
  /** Human-readable details when stale=true; absent when fresh. */
  details?: string;
}

/**
 * Walk a directory recursively and return the newest mtime found, or 0 if
 * the directory doesn't exist or can't be read. Never throws.
 */
function newestMtimeMs(dir: string): number {
  let newest = 0;
  let stack: string[];
  try {
    stack = [dir];
  } catch {
    return 0;
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, String(entry.name));
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile()) {
          const s = statSync(full);
          if (s.mtimeMs > newest) newest = s.mtimeMs;
        }
      } catch {
        // skip unreadable entries
      }
    }
  }
  return newest;
}

/**
 * Returns { stale: true, details } when any source file under
 * `src/eval-server/` or `src/utils/` is newer than every file under
 * `dist/eval-server/` and `dist/utils/`.
 *
 * Returns { stale: false } when:
 *   - dist is current or newer
 *   - either dist/ or src/ subtree is missing (production install)
 *   - any fs error occurs (best-effort, never fatal)
 *
 * The 1-second tolerance avoids false positives on filesystems where mtime
 * precision is coarse and src/dist were written within the same tick.
 */
export function checkDistFreshness(rootDir: string): DistFreshnessResult {
  try {
    const srcDirs = ["src/eval-server", "src/utils"];
    const distDirs = ["dist/eval-server", "dist/utils"];

    let srcMtime = 0;
    for (const d of srcDirs) {
      const m = newestMtimeMs(join(rootDir, d));
      if (m > srcMtime) srcMtime = m;
    }

    let distMtime = 0;
    for (const d of distDirs) {
      const m = newestMtimeMs(join(rootDir, d));
      if (m > distMtime) distMtime = m;
    }

    // Either subtree missing (mtime=0) → can't make a useful claim.
    if (srcMtime === 0 || distMtime === 0) return { stale: false };

    const TOLERANCE_MS = 1000;
    if (srcMtime > distMtime + TOLERANCE_MS) {
      const ageSec = Math.round((srcMtime - distMtime) / 1000);
      return {
        stale: true,
        details: `src is ${ageSec}s newer than dist`,
      };
    }
    return { stale: false };
  } catch {
    return { stale: false };
  }
}
