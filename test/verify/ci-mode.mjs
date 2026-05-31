// CI-awareness for the verify harness (0858 AC-US1-01/02).
//
// Some inherited units assume a developer machine: real coding agents installed
// under ~/.claude (cross-agent install dirs) or a spawnable `vskill studio`. On a
// bare GitHub-hosted runner those preconditions don't hold, so the units FAIL for
// environmental reasons — not real regressions. In CI we SKIP-LOUD those units
// instead of letting them turn the run red.
//
// Detection is keyed on the standard `CI=true` (GitHub Actions sets this
// automatically) OR an explicit `VSKILL_VERIFY_CI=1` opt-in. Outside CI every
// unit runs exactly as before — zero behavior change on a dev machine.

/** @returns {boolean} true when the harness should apply CI-skip semantics. */
export function isCiMode(env = process.env) {
  return env.CI === "true" || env.VSKILL_VERIFY_CI === "1";
}

/**
 * A unit is CI-skippable when it explicitly declares `ciSafe: false`. The flag
 * is opt-OUT: units with no flag (or `ciSafe: true`) are treated as hermetic and
 * always run. This keeps the classification declarative and per-unit rather than
 * a hardcoded name list in the runner.
 *
 * @param {{ ciSafe?: boolean }} unit
 * @returns {boolean}
 */
export function isCiSafe(unit) {
  return unit?.ciSafe !== false;
}

/**
 * Emit a GitHub Actions `::warning::` annotation for a SKIP-LOUD unit so a bare
 * runner surfaces exactly why coverage was reduced. No-op formatting-wise off CI,
 * but we still print it (harmless) so the reason is visible in any log.
 *
 * @param {{ id: string, ciSkipReason?: string }} unit
 */
export function warnCiSkip(unit) {
  const reason = unit?.ciSkipReason || "ciSafe:false (no reason given)";
  console.warn(`::warning:: verify CI-SKIP ${unit.id} — ${reason}`);
}
