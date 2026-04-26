// ---------------------------------------------------------------------------
// 0759 Phase 7 — bumpVersion + validateVersionTransition.
//
// Pure semver helpers. The platform enforces strict monotonicity at publish
// time (publish.ts MonotonicityError). These helpers add a friendlier
// client-side guard at Save time — authors can't accidentally jump
// 1.0.5 → 5.0.0 in the textarea and only hear about it during `vskill
// publish`.
//
// Bump rules:
//   - patch: increments patch by 1, leaves major/minor untouched
//   - minor: increments minor by 1, resets patch to 0
//   - major: increments major by 1, resets minor + patch to 0
// Pre-release / build-metadata suffixes are stripped on bump (we don't try to
// model semver-spec pre-release ordering — keep it simple).
//
// Transition rules (validateVersionTransition):
//   - same version → valid (no-op save)
//   - exactly one of (major, minor, patch) increased by 1, with all lower
//     segments reset to 0 → valid
//   - anything else → invalid with a human-readable reason
//   - `from === null` → only validates that `to` is well-formed
// ---------------------------------------------------------------------------

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

interface Parsed {
  major: number;
  minor: number;
  patch: number;
}

function parse(raw: string): Parsed | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(SEMVER_RE);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export type BumpKind = "patch" | "minor" | "major";

export function bumpVersion(current: string, kind: BumpKind): string {
  const p = parse(current);
  if (!p) {
    throw new Error(`bumpVersion: not a valid semver: ${JSON.stringify(current)}`);
  }
  switch (kind) {
    case "patch":
      return `${p.major}.${p.minor}.${p.patch + 1}`;
    case "minor":
      return `${p.major}.${p.minor + 1}.0`;
    case "major":
      return `${p.major + 1}.0.0`;
  }
}

export interface TransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateVersionTransition(
  from: string | null | undefined,
  to: string,
): TransitionResult {
  const toParsed = parse(to);
  if (!toParsed) {
    return { valid: false, reason: `Invalid semver: ${JSON.stringify(to)}` };
  }
  if (from === null || from === undefined) {
    // First-time save — accept any well-formed semver.
    return { valid: true };
  }
  const fromParsed = parse(from);
  if (!fromParsed) {
    // If we can't parse the prior version, don't block the user.
    return { valid: true };
  }

  // Same version → no-op save.
  if (
    fromParsed.major === toParsed.major &&
    fromParsed.minor === toParsed.minor &&
    fromParsed.patch === toParsed.patch
  ) {
    return { valid: true };
  }

  // Reject any decrease.
  if (
    toParsed.major < fromParsed.major ||
    (toParsed.major === fromParsed.major && toParsed.minor < fromParsed.minor) ||
    (toParsed.major === fromParsed.major &&
      toParsed.minor === fromParsed.minor &&
      toParsed.patch < fromParsed.patch)
  ) {
    return {
      valid: false,
      reason: `Version cannot decrease (from ${from} → ${to}). Use the same or higher version.`,
    };
  }

  // Major bump: must be exactly +1 with minor and patch reset to 0.
  if (toParsed.major !== fromParsed.major) {
    if (toParsed.major !== fromParsed.major + 1) {
      return {
        valid: false,
        reason: `Major version can only increase by 1 at a time (got ${fromParsed.major} → ${toParsed.major}).`,
      };
    }
    if (toParsed.minor !== 0 || toParsed.patch !== 0) {
      return {
        valid: false,
        reason: `When bumping major, minor and patch must be reset to 0 (got ${to}; expected ${toParsed.major}.0.0).`,
      };
    }
    return { valid: true };
  }

  // Minor bump: must be exactly +1 with patch reset to 0.
  if (toParsed.minor !== fromParsed.minor) {
    if (toParsed.minor !== fromParsed.minor + 1) {
      return {
        valid: false,
        reason: `Minor version can only increase by 1 at a time (got ${fromParsed.minor} → ${toParsed.minor}).`,
      };
    }
    if (toParsed.patch !== 0) {
      return {
        valid: false,
        reason: `When bumping minor, patch must be reset to 0 (got ${to}; expected ${toParsed.major}.${toParsed.minor}.0).`,
      };
    }
    return { valid: true };
  }

  // Patch bump: must be exactly +1.
  if (toParsed.patch !== fromParsed.patch + 1) {
    return {
      valid: false,
      reason: `Patch version can only increase by 1 at a time (got ${fromParsed.patch} → ${toParsed.patch}).`,
    };
  }
  return { valid: true };
}
