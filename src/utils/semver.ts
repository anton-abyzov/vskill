// ---------------------------------------------------------------------------
// Semver precedence for version strings found on disk (plugin cache folders,
// plugin.json, lockfile entries). A plain string sort puts 3.0.6 above 3.0.14;
// this compares major, minor and patch as numbers, then the pre-release tag.
// ---------------------------------------------------------------------------

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers ("beta.2" -> ["beta", "2"]); empty for a release. */
  pre: string[];
}

/** Parse "1.2.3", "v1.2.3", "1.2.3-beta.1" or "1.2.3+build"; null otherwise. */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split(".") : [],
  };
}

function comparePre(a: string[], b: string[]): number {
  // A release outranks any pre-release of the same version.
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i >= a.length) return -1;
    if (i >= b.length) return 1;
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) - Number(y);
    if (xNum) return -1; // numeric identifiers sort below alphanumeric ones
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Compare two version strings by semver precedence: negative when a < b,
 * positive when a > b, 0 when equal. A string that is not a version sorts
 * below every version; two such strings compare as plain text.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    if (pa) return 1;
    if (pb) return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  return comparePre(pa.pre, pb.pre);
}

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
