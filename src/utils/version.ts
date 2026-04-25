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

/**
 * Set or insert the `version:` field inside SKILL.md frontmatter.
 *
 * Behavior:
 *  - If frontmatter exists and contains `version:` → replace its value.
 *  - If frontmatter exists but has no `version:` → insert as the first field.
 *  - If no frontmatter at all → prepend a minimal `---\nversion: "X"\n---` block.
 *
 * The version is always emitted quoted to match the convention used by
 * skill-create-routes' buildSkillMd emitter and to keep YAML parsers happy
 * for non-numeric semver strings.
 */
export function setFrontmatterVersion(content: string, version: string): string {
  const fmMatch = content.match(/^(---\s*\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) {
    return `---\nversion: "${version}"\n---\n\n${content}`;
  }

  const [, openFence, body, closeFence] = fmMatch;
  const versionLineRe = /^version:\s*"?[^\n]*"?\s*$/m;
  let newBody: string;
  if (versionLineRe.test(body)) {
    newBody = body.replace(versionLineRe, `version: "${version}"`);
  } else {
    // Insert version as the first frontmatter line so it's stable + obvious.
    newBody = `version: "${version}"\n${body}`;
  }

  return content.replace(fmMatch[0], `${openFence}${newBody}${closeFence}`);
}
