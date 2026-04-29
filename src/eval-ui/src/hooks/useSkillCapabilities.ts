// ---------------------------------------------------------------------------
// 0800: useSkillCapabilities — split capability flags.
//
// Replaces the legacy `isReadOnly = origin === "installed"` flag with two
// orthogonal capabilities:
//
//   - canEdit: user may mutate eval cases (Add Test Case, per-case Edit /
//              Delete, per-case Run All authoring shortcuts) → true when
//              the skill is the user's own source copy.
//   - canRun:  user may execute eval cases (per-case Run, Run All) → true
//              when the skill has at least one case in evals.json,
//              regardless of origin. The backend already accepts benchmark
//              requests for installed skills (see api-routes.ts:2948); the
//              frontend just needs to stop hiding the buttons.
//
// AC mapping:
//   AC-US2-01: installed + cases → canRun=true (Run buttons visible)
//   AC-US2-03: installed → canEdit=false (Add/Edit/Delete hidden)
//   AC-US1-04: autorun guard depends on canRun
//
// ---------------------------------------------------------------------------

export interface SkillCapabilitiesInput {
  origin: "source" | "installed";
}

export interface EvalsCapabilitiesInput {
  /** Whether evals.json exists on disk for this skill. */
  exists: boolean;
  /** The list of eval cases (any shape — only `length` is read). */
  cases: ReadonlyArray<unknown>;
}

export interface SkillCapabilities {
  /** True when the user may mutate eval cases. */
  canEdit: boolean;
  /** True when the user may execute eval cases (case list non-empty). */
  canRun: boolean;
}

/**
 * Pure derivation — no React state. Named with the `use` prefix to match
 * the project's hook conventions and so consumers can swap to a memoised
 * variant later without API churn.
 *
 * @param skill   Selected skill — `null` is treated as no-capabilities.
 * @param evals   Loaded evals envelope — `cases` may be empty.
 */
export function useSkillCapabilities(
  skill: SkillCapabilitiesInput | null | undefined,
  evals: EvalsCapabilitiesInput,
): SkillCapabilities {
  if (!skill) {
    return { canEdit: false, canRun: false };
  }
  const canEdit = skill.origin === "source";
  const canRun = evals.exists && evals.cases.length > 0;
  return { canEdit, canRun };
}
