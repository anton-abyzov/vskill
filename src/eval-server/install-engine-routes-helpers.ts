// ---------------------------------------------------------------------------
// install-engine-routes-helpers.ts — extracted prerequisite-CLI lookup so it
// can be mocked independently of node:child_process in unit tests.
// Ref: 0734 AC-US5-02
//
// Now a thin re-export of the shared `whichSync` helper; the previous
// inline `spawnSync`-based implementation lives in utils/which.ts.
// ---------------------------------------------------------------------------

import { whichSync } from "./utils/which.js";

/**
 * Returns true when `cmd` resolves to an executable on PATH.
 * Uses `which` / `where` under the hood with metacharacter guard + cache.
 */
export function isCliAvailable(cmd: string): boolean {
  return whichSync(cmd);
}
