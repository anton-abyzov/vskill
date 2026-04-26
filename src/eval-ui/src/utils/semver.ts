// ---------------------------------------------------------------------------
// Browser-safe semver validator for the Studio create-skill VersionInput.
// Zero-dep — same regex shape as vskill-platform/src/lib/integrity/semver.ts.
// Ref: 0734 AC-US4-02.
// ---------------------------------------------------------------------------

const NUMERIC = "(?:0|[1-9]\\d*)";
const ALPHANUM = "[0-9A-Za-z-]";
// Pre-release identifier: NUMERIC OR (alphanumeric, but NOT all-digit-with-leading-zero)
const PRE_IDENT = `(?:${NUMERIC}|\\d*[A-Za-z-]${ALPHANUM}*)`;
const BUILD_IDENT = `${ALPHANUM}+`;
const PRERELEASE = `(?:-${PRE_IDENT}(?:\\.${PRE_IDENT})*)`;
const BUILD = `(?:\\+${BUILD_IDENT}(?:\\.${BUILD_IDENT})*)`;

const SEMVER_RE = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}${PRERELEASE}?${BUILD}?$`,
);

export function isValidSemver(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return SEMVER_RE.test(input.trim());
}
