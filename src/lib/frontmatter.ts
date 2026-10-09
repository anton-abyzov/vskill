/**
 * Frontmatter version upsert.
 *
 * After `vskill skill publish` succeeds, the registry returns the new
 * version (which may have been auto-bumped server-side). To prevent the
 * "phantom update available immediately after install" trap recorded in
 * project_skill_version_publish_desync.md, the CLI writes the registry
 * version back to the source SKILL.md frontmatter so that the next
 * `vskill outdated` poll sees identical local + remote versions.
 *
 * Increment 0794 — US-002b / T-004.
 */

import { setFrontmatterVersion } from "../utils/version.js";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const TOP_VERSION_RE = /^version\s*:\s*[^\n]*\r?\n?/m;

/**
 * Update the published version, preserving legacy root quoting where present.
 *
 * Behaviour:
 *   - If `version:` exists at column 1: replace its value (preserves
 *     surrounding lines and quoting style of the source whenever possible).
 *   - New fields and existing metadata.version use the portable metadata shape.
 *   - If the file has no frontmatter block at all: synthesise a minimal one.
 *
 * Returns the full file content with the change applied. Pure function.
 */
export function upsertFrontmatterVersion(content: string, newVersion: string): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match || !TOP_VERSION_RE.test(match[1])) {
    return setFrontmatterVersion(content, newVersion);
  }

  const fmBody = match[1];

  // Replace existing top-level `version:`
  const newFm = fmBody.replace(TOP_VERSION_RE, (line) => {
    // Preserve quoting style if present
    const quotedMatch = line.match(/^version\s*:\s*("|')/);
    if (quotedMatch) {
      const quote = quotedMatch[1];
      return `version: ${quote}${newVersion}${quote}\n`;
    }
    return `version: ${newVersion}\n`;
  });
  return content.replace(FRONTMATTER_RE, () => `---\n${newFm}\n---\n`);
}

/**
 * Lightweight validation: round-trip the result through the frontmatter regex
 * and ensure we still have a valid `---\n...\n---` block. Used by submit.ts
 * as a defensive guard before writing back to disk (AC-US2b-04).
 */
export function validatesAsYamlFrontmatter(content: string): boolean {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return false;
  // Sanity: no nested unclosed --- markers
  const body = m[1];
  if (/^---\s*$/m.test(body)) return false;
  return true;
}
