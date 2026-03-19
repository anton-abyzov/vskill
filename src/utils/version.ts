// ---------------------------------------------------------------------------
// Version utilities for skill versioning
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Extract the `version` field from YAML frontmatter in SKILL.md content.
 * Returns the version string if it is valid semver, otherwise undefined.
 */
export function extractFrontmatterVersion(
  content: string,
): string | undefined {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return undefined;

  const frontmatter = fmMatch[1];
  const versionMatch = frontmatter.match(
    /^version:\s*"?(\S+?)"?\s*$/m,
  );
  if (!versionMatch) return undefined;

  const version = versionMatch[1];
  return SEMVER_RE.test(version) ? version : undefined;
}

/**
 * Increment the patch component of a semver string.
 * Returns "1.0.1" if the input is not valid semver.
 */
export function bumpPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
    return "1.0.1";
  }
  const patch = parseInt(parts[2], 10) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

/**
 * Resolve the version to record in the lockfile.
 *
 * Priority chain: server > frontmatter > auto-patch > "1.0.0"
 */
export function resolveVersion(opts: {
  serverVersion?: string;
  frontmatterVersion?: string;
  currentVersion?: string;
  hashChanged: boolean;
  isFirstInstall: boolean;
}): string {
  if (opts.serverVersion) return opts.serverVersion;
  if (opts.frontmatterVersion) return opts.frontmatterVersion;

  if (opts.currentVersion) {
    return opts.hashChanged
      ? bumpPatch(opts.currentVersion)
      : opts.currentVersion;
  }

  return "1.0.0";
}
