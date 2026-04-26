// ---------------------------------------------------------------------------
// install-engine-routes-helpers.ts — extracted prerequisite-CLI lookup so it
// can be mocked independently of node:child_process in unit tests.
// Ref: 0734 AC-US5-02
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";

/**
 * Returns true when `cmd` resolves to an executable on PATH.
 *
 * Uses `which` (POSIX) / `where` (Windows). Pure best-effort: any failure to
 * spawn the lookup process is treated as "not available".
 */
export function isCliAvailable(cmd: string): boolean {
  if (!cmd || /[^a-zA-Z0-9_-]/.test(cmd)) return false; // hard guard against shell metacharacters

  const lookup = process.platform === "win32" ? "where" : "which";
  try {
    const res = spawnSync(lookup, [cmd], { stdio: "ignore" });
    return res.status === 0;
  } catch {
    return false;
  }
}
