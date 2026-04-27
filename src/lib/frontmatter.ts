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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const TOP_VERSION_RE = /^version\s*:\s*[^\n]*\r?\n?/m;
const HAS_DESCRIPTION_RE = /^description\s*:/m;

/**
 * Insert or replace the top-level `version:` field in YAML frontmatter.
 *
 * Behaviour:
 *   - If `version:` exists at column 1: replace its value (preserves
 *     surrounding lines and quoting style of the source whenever possible).
 *   - Else if `description:` exists at column 1: insert immediately after
 *     the description block (skipping indented continuation lines).
 *   - Else: append the version line at the end of the frontmatter.
 *   - If the file has no frontmatter block at all: synthesise a minimal one.
 *   - Indented `metadata.version` is never touched.
 *
 * Returns the full file content with the change applied. Pure function.
 */
export function upsertFrontmatterVersion(content: string, newVersion: string): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return `---\nversion: ${newVersion}\n---\n${content}`;
  }

  const fmBody = match[1];

  // Replace existing top-level `version:`
  if (TOP_VERSION_RE.test(fmBody)) {
    const newFm = fmBody.replace(TOP_VERSION_RE, (line) => {
      // Preserve quoting style if present
      const quotedMatch = line.match(/^version\s*:\s*("|')/);
      if (quotedMatch) {
        const quote = quotedMatch[1];
        return `version: ${quote}${newVersion}${quote}\n`;
      }
      return `version: ${newVersion}\n`;
    });
    return content.replace(FRONTMATTER_RE, `---\n${newFm}\n---\n`);
  }

  // Insert after `description:` if present
  const lines = fmBody.split(/\r?\n/);
  const descIdx = lines.findIndex((line) => HAS_DESCRIPTION_RE.test(line));
  let updatedLines: string[];
  if (descIdx >= 0) {
    let insertAt = descIdx + 1;
    // Skip continuation lines (indented under description)
    while (insertAt < lines.length && /^\s+\S/.test(lines[insertAt])) insertAt++;
    updatedLines = [
      ...lines.slice(0, insertAt),
      `version: ${newVersion}`,
      ...lines.slice(insertAt),
    ];
  } else {
    updatedLines = [...lines, `version: ${newVersion}`];
  }

  const newFm = updatedLines.join("\n");
  return content.replace(FRONTMATTER_RE, `---\n${newFm}\n---\n`);
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
