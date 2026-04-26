// ---------------------------------------------------------------------------
// 0759 Phase 7 — frontmatter version read/write helpers.
//
// Pure string manipulation: reads or replaces the `version:` line inside a
// markdown YAML frontmatter block. We deliberately avoid pulling in a full
// YAML library here — the version line is single-key and easy to handle with
// regex, and the broader frontmatter is already parsed elsewhere via
// parseFrontmatter() for read-side consumers.
//
// Always emits the version line as `version: "<value>"` (double-quoted)
// regardless of whether the input was quoted, so the file stays consistent
// after a bump.
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const VERSION_LINE_RE = /^version:\s*["']?([^"'\n]+?)["']?\s*$/m;

export function getFrontmatterVersion(content: string): string | null {
  const fm = content.match(FRONTMATTER_RE);
  if (!fm) return null;
  const m = fm[1].match(VERSION_LINE_RE);
  if (!m) return null;
  return m[1].trim() || null;
}

export function setFrontmatterVersion(content: string, newVersion: string): string {
  const versionLine = `version: "${newVersion}"`;
  const fm = content.match(FRONTMATTER_RE);

  if (!fm) {
    // No frontmatter block — prepend a minimal one.
    return `---\n${versionLine}\n---\n${content}`;
  }

  const block = fm[1];
  const blockEndIdx = (fm.index ?? 0) + fm[0].length;
  const after = content.slice(blockEndIdx);
  const beforeFence = content.slice(0, fm.index ?? 0);

  let newBlock: string;
  if (VERSION_LINE_RE.test(block)) {
    // Replace existing version line in place.
    newBlock = block.replace(VERSION_LINE_RE, versionLine);
  } else {
    // Insert version line at the top of the frontmatter block.
    newBlock = `${versionLine}\n${block}`;
  }

  // Preserve the trailing newline pattern of the original block close.
  const closer = fm[0].endsWith("---\n") ? "---\n" : "---";
  return `${beforeFence}---\n${newBlock}\n${closer}${after}`;
}
