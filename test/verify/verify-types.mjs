// Shape vocabulary — JSDoc only, no runtime types needed.
// Mirrors src/verify/core/types.ts in cwc-workshops/phase-3-verify.

/**
 * @typedef {"PASS"|"FAIL"|"BLOCKED"|"SKIP"} Verdict
 *
 * @typedef {Object} Check
 * @property {string} id
 * @property {"ok"|"fail"|"warn"|"probe"} status
 * @property {string} [message]
 * @property {unknown} [actual]
 * @property {unknown} [expected]
 *
 * @typedef {Object} Invariant
 * @property {string} id
 * @property {string} description
 * @property {(surface: any) => boolean | Promise<boolean>} predicate
 *
 * @typedef {Object} FixtureCtx
 * @property {string} workdir          - tmp workdir created per fixture
 * @property {Record<string,string>} env - extra env vars for child processes
 *
 * @typedef {Object} Fixture
 * @property {string} id
 * @property {string} description
 * @property {boolean} [probe]
 * @property {Verdict} [expect] - 0857: declared adverse verdict for a lie-detector
 *   probe (e.g. "BLOCKED" or "FAIL"). When the observed verdict matches, the
 *   probe is treated as PASS for the unit roll-up; the raw verdict is still
 *   recorded verbatim in the FixtureResult JSON.
 * @property {(ctx: FixtureCtx) => Promise<any>} act - returns the surface object
 *
 * @typedef {Object} VerifiableUnit
 * @property {string} id
 * @property {string} command           - human description ("vskill install <source>")
 * @property {any}    surfaceSchema     - Zod schema for surface
 * @property {Invariant[]} invariants
 * @property {Fixture[]} fixtures
 * @property {boolean} [ciSafe]         - 0858: false = SKIP-LOUD under CI (needs a
 *   developer machine: real coding agents installed or a spawnable studio).
 *   Defaults to true (hermetic, always runs).
 * @property {string} [ciSkipReason]    - 0858: human reason surfaced in the
 *   ::warning:: annotation when this unit is CI-skipped.
 *
 * @typedef {Object} FixtureResult
 * @property {string} unitId
 * @property {string} fixtureId
 * @property {boolean} probe
 * @property {Verdict} verdict
 * @property {Verdict} [expected] - 0857: the declared adverse verdict (echo of Fixture.expect)
 * @property {boolean} [expectedMet] - 0857: true when observed verdict === expected
 * @property {Check[]} checks
 * @property {any} [surface]
 * @property {number} durationMs
 * @property {string} [blockedReason]
 *
 * @typedef {Object} UnitResult
 * @property {string} unitId
 * @property {string} command
 * @property {Verdict} verdict
 * @property {FixtureResult[]} fixtures
 * @property {boolean} [skipped]    - 0858: true when CI-skipped (not executed)
 * @property {string} [skipReason]  - 0858: ciSkipReason echoed onto the result
 *
 * @typedef {Object} RunAllResult
 * @property {string} version
 * @property {string} runAt
 * @property {boolean} [ci]         - 0858: true when run under CI-skip semantics
 * @property {Verdict} verdict
 * @property {UnitResult[]} units
 */

export {};
