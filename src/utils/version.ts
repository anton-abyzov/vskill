// ---------------------------------------------------------------------------
// Version utilities for skill versioning
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const FRONTMATTER_RE = /^(---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?=\r?\n|$))/;

/** Locate only direct children of a block-style metadata mapping. */
function versionFields(lines: string[]) {
  const root = lines.findIndex((line) => /^version[ \t]*:/.test(line));
  const metadata = lines.findIndex((line) => /^metadata[ \t]*:[ \t]*(?:#.*)?$/.test(line));
  let end = metadata + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s|^#/.test(lines[end]))) end++;
  const children = metadata < 0 ? [] : lines.slice(metadata + 1, end);
  const indents = children.filter((line) => /^ +[^ #]/.test(line))
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length ? Math.min(...indents) : 2;
  const childPattern = new RegExp(`^ {${indent}}version[ \\t]*:`);
  const nestedOffset = children.findIndex((line) => childPattern.test(line));
  return { root, metadata, nested: nestedOffset < 0 ? -1 : metadata + 1 + nestedOffset, indent };
}

function versionCandidates(content: string): Array<string | undefined> {
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) return [];
  const lines = fm[2].split(/\r?\n/);
  const { root, nested } = versionFields(lines);
  return [root, nested].filter((index) => index >= 0).map((index) => {
    const raw = lines[index].slice(lines[index].indexOf(":") + 1).trim();
    const value = raw.match(/^(?:"([^"]*)"|'([^']*)'|([^#]*))/);
    return (value?.[1] ?? value?.[2] ?? value?.[3])?.trim() || undefined;
  });
}

/** Read metadata.version while accepting the legacy root-level field. */
export function readFrontmatterVersion(content: string): string | undefined {
  // Preserve precedence for existing files containing both forms.
  return versionCandidates(content).find((version) => version !== undefined);
}

/**
 * Extract the `version` field from YAML frontmatter in SKILL.md content.
 * Returns the version string if it is valid semver, otherwise undefined.
 */
export function extractFrontmatterVersion(
  content: string,
): string | undefined {
  return versionCandidates(content).find((version) => version !== undefined && SEMVER_RE.test(version));
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
 * Update a skill version in place. Existing legacy root versions retain their
 * shape; new fields use portable metadata.version. Other metadata and body
 * content are preserved, including CRLF and literal replacement characters.
 */
export function setFrontmatterVersion(content: string, version: string): string {
  const fmMatch = content.match(FRONTMATTER_RE);
  const quoted = JSON.stringify(version);
  if (!fmMatch) {
    return `---\nmetadata:\n  version: ${quoted}\n---\n${content}`;
  }

  const [, openFence, body, closeFence] = fmMatch;
  const newline = openFence.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  // This narrow writer does not parse quoted YAML mapping keys (including
  // escaped spellings). Refuse them rather than append a duplicate metadata
  // or version key and lose fields in permissive downstream parsers.
  if (lines.some((line) => /^[ \t]*["'][^\r\n]*["'][ \t]*:/.test(line))) {
    throw new Error("Cannot update version: quoted keys need a YAML-aware edit");
  }
  const { root, metadata, nested, indent } = versionFields(lines);
  const existing = root >= 0 ? root : nested;
  if (existing >= 0) {
    const value = lines[existing].slice(lines[existing].indexOf(":") + 1).trim();
    const existingIndent = root >= 0 ? 0 : indent;
    // A one-line replacement would leave block/folded or quoted-scalar
    // continuation lines orphaned. Detect before changing any line.
    if (/^[|>]/.test(value)) {
      throw new Error("Cannot update version: multiline version needs a YAML-aware edit");
    }
    for (let next = existing + 1; next < lines.length; next++) {
      if (!lines[next].trim() || /^[ \t]*#/.test(lines[next])) continue;
      if (lines[next].length - lines[next].trimStart().length > existingIndent) {
        throw new Error("Cannot update version: multiline version needs a YAML-aware edit");
      }
      break;
    }
  }
  if (root >= 0) {
    lines[root] = `version: ${quoted}`;
  } else if (nested >= 0) {
    lines[nested] = `${" ".repeat(indent)}version: ${quoted}`;
  } else if (metadata >= 0) {
    lines.splice(metadata + 1, 0, `${" ".repeat(indent)}version: ${quoted}`);
  } else {
    // Never turn an inline/scalar metadata declaration into duplicate keys.
    // Studio emits block mappings; other shapes need a YAML-aware edit first.
    if (lines.some((line) => /^metadata[ \t]*:/.test(line))) {
      throw new Error("Cannot update version: metadata must use a block mapping");
    }
    lines.push("metadata:", `  version: ${quoted}`);
  }
  return `${openFence}${lines.join(newline)}${closeFence}${content.slice(fmMatch[0].length)}`;
}
