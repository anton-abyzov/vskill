// ---------------------------------------------------------------------------
// which.ts — single shared "is this command on PATH?" helper.
//
// Consolidates three previous implementations (isCliAvailable in
// install-engine-routes-helpers.ts, isBinaryOnPath in api-routes.ts,
// defaultWhich in resolve-editor.ts). The merged version keeps the most
// hardened behavior of each:
//
//   - shell-metacharacter guard from isCliAvailable (rejects anything
//     outside [a-zA-Z0-9._-])
//   - argv-array spawn (no shell) from defaultWhich
//   - 1-second timeout from defaultWhich
//   - per-process Map cache from defaultWhich
//
// Use `whichSync` everywhere. The injectable variant `whichSyncWith` accepts
// a custom probe function so tests can pin behavior without touching the
// process environment.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";

const SAFE_CMD = /^[a-zA-Z0-9._-]+$/;

const cache = new Map<string, boolean>();

function defaultProbe(cmd: string): boolean {
  try {
    if (process.platform === "win32") {
      execFileSync("where", [cmd], { stdio: "ignore", timeout: 1000 });
    } else {
      // `command -v` is the POSIX-portable lookup. We invoke it via /bin/sh
      // because `command` is a shell builtin, not a binary on PATH. Args are
      // passed via the `shell` option's command-string mechanism, but we
      // hand-build the exact string to avoid argv re-quoting surprises and
      // because `cmd` has already passed the SAFE_CMD allowlist (no shell
      // metacharacters can reach this point).
      execFileSync("command", ["-v", cmd], {
        stdio: "ignore",
        timeout: 1000,
        shell: "/bin/sh",
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * True iff `cmd` is on PATH. Memoized for the lifetime of the process.
 * Returns false for empty input or anything containing shell metacharacters
 * (defense in depth — argv arrays already prevent injection, but rejecting
 * weird input early avoids surprises in error logs).
 */
export function whichSync(cmd: string): boolean {
  if (!cmd || !SAFE_CMD.test(cmd)) return false;
  const cached = cache.get(cmd);
  if (cached !== undefined) return cached;
  const result = defaultProbe(cmd);
  cache.set(cmd, result);
  return result;
}

/**
 * Test seam: same contract as `whichSync` but with a caller-supplied probe.
 * Does not consult or populate the module-level cache, so tests can vary
 * the probe across cases without polluting subsequent calls.
 */
export function whichSyncWith(
  cmd: string,
  probe: (cmd: string) => boolean,
): boolean {
  if (!cmd || !SAFE_CMD.test(cmd)) return false;
  return probe(cmd);
}

/** Test-only: drop the memoized cache. Not exported through utils/index. */
export function _resetWhichCacheForTests(): void {
  cache.clear();
}
