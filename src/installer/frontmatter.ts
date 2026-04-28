/** Matches a valid YAML frontmatter block: opening ---, content, closing --- */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** agentskills.io name format: lowercase alphanumeric + hyphens, 2-64 chars */
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/** Single lowercase alphanumeric character (valid 1-char skill name) */
const SINGLE_CHAR_RE = /^[a-z0-9]$/;

/** Claude Code-specific frontmatter fields that non-Claude agents don't support */
const CLAUDE_FIELD_PATTERNS = [
  /^user-invoc?k?able\s*:.*\n?/gm,
  /^allowed-tools\s*:.*\n?/gm,
  /^model\s*:.*\n?/gm,
  /^argument-hint\s*:.*\n?/gm,
  /^context\s*:.*\n?/gm,
];

/** Detects `name:` field at the start of a line in frontmatter */
const HAS_NAME_RE = /^name:/m;

/** Matches an entire `name:` line including its value (used to replace the whole line, not just the token) */
const NAME_LINE_RE = /^name:.*$/m;

/** Captures the value of the first `name:` line (used to detect idempotent renames) */
const NAME_VALUE_RE = /^name:\s*(.*)$/m;

/** Detects `description:` field at the start of a line in frontmatter */
const HAS_DESCRIPTION_RE = /^description:/m;

/** Max description length per agentskills.io standard */
const MAX_DESCRIPTION_LENGTH = 200;

/** YAML-special characters that require quoting */
const YAML_SPECIAL_RE = /[:#\[\]{}'*&!>|"\\]/;

/** YAML boolean words that need quoting when they start a value */
const YAML_BOOL_START_RE = /^(true|false|yes|no|on|off|null)\b/i;

/**
 * Quote a YAML value if it contains special characters.
 * Escapes inner backslashes and double quotes, wraps in "...".
 */
export function quoteYAMLValue(value: string): string {
  if (!YAML_SPECIAL_RE.test(value) && !YAML_BOOL_START_RE.test(value)) {
    return value;
  }
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Validate a skill name against the agentskills.io standard.
 * Must be lowercase alphanumeric with hyphens, 1-64 chars, no leading/trailing hyphens.
 */
export function validateSkillNameStrict(name: string): boolean {
  if (name.length === 0 || name.length > 64) return false;
  if (name.length === 1) return SINGLE_CHAR_RE.test(name);
  return SKILL_NAME_RE.test(name);
}

/**
 * Extract a description from the body of a SKILL.md file.
 * Returns the first non-heading, non-blank line, truncated to 200 chars.
 * Falls back to a humanized version of the skill name.
 */
export function extractDescription(body: string, skillName: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    return trimmed.length > MAX_DESCRIPTION_LENGTH
      ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH)
      : trimmed;
  }
  return skillName.replace(/-/g, " ");
}

/**
 * Ensure a SKILL.md string contains valid `name` and `description` frontmatter.
 * Pure function — normalizes CRLF, preserves existing fields, injects missing ones.
 * When `forceName` is true, overrides the existing `name` field with `skillName`.
 */
export function ensureFrontmatter(content: string, skillName: string, forceName = false): string {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);

  if (!match) {
    const desc = extractDescription(normalized, skillName);
    return `---\nname: ${skillName}\ndescription: ${quoteYAMLValue(desc)}\n---\n\n${normalized}`;
  }

  const fmBlock = match[1];
  const hasName = HAS_NAME_RE.test(fmBlock);
  const hasDescription = HAS_DESCRIPTION_RE.test(fmBlock);

  if (hasName && hasDescription && !forceName) {
    return normalized;
  }

  // When forceName is set, replace existing name field with the namespaced name.
  // Idempotence guard: if the existing name already equals the requested name AND
  // a description is present, this branch is a no-op — return the source unchanged
  // so installs never mutate already-valid frontmatter (the no-touch principle).
  if (forceName && hasName) {
    const currentNameMatch = fmBlock.match(NAME_VALUE_RE);
    const currentName = currentNameMatch?.[1].trim() ?? "";
    const namesMatch = currentName === skillName;

    if (namesMatch && hasDescription) {
      return normalized;
    }

    // Replace the WHOLE name line (not just the `name:` token) so the old value
    // is overwritten cleanly. The previous regex matched only `^name:` and left
    // the old value dangling, producing `name: foo foo` corruption.
    const updatedFm = namesMatch ? fmBlock : fmBlock.replace(NAME_LINE_RE, `name: ${skillName}`);

    if (hasDescription) {
      // Description already present — preserve it verbatim, only the name changed.
      return normalized.replace(FRONTMATTER_RE, `---\n${updatedFm}\n---`);
    }

    // No description in source — extract one from the body and append.
    const body = normalized.slice(match[0].length);
    const extractedDesc = extractDescription(body, skillName);
    return normalized.replace(
      FRONTMATTER_RE,
      `---\n${updatedFm}\ndescription: ${quoteYAMLValue(extractedDesc)}\n---`,
    );
  }

  let updatedBlock = fmBlock;

  if (!hasName) {
    updatedBlock = `name: ${skillName}\n${updatedBlock}`;
  }

  if (!hasDescription) {
    const body = normalized.slice(match[0].length);
    const desc = extractDescription(body, skillName);
    updatedBlock = `${updatedBlock}\ndescription: ${quoteYAMLValue(desc)}`;
  }

  return normalized.replace(FRONTMATTER_RE, `---\n${updatedBlock}\n---`);
}

/** Detects `target-agents:` field in frontmatter */
const HAS_TARGET_AGENTS_RE = /^target-agents:\s*(.*)/m;

/**
 * Parse the optional `target-agents` field from SKILL.md frontmatter.
 * Returns an array of agent IDs, or undefined if the field is absent.
 */
export function parseTargetAgents(content: string): string[] | undefined {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) return undefined;

  const fmBlock = match[1];
  const agentsMatch = fmBlock.match(HAS_TARGET_AGENTS_RE);
  if (!agentsMatch) return undefined;

  const raw = agentsMatch[1].trim().replace(/^["']|["']$/g, "");
  const agents = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return agents.length > 0 ? agents : undefined;
}

/**
 * Strip Claude Code-specific frontmatter fields for non-Claude agents.
 * Removes: user-invocable, allowed-tools, model, argument-hint, context.
 * Ensures `name:` is present (required by all agents).
 */
export function stripClaudeFields(content: string, skillName: string): string {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---")) {
    const desc = extractDescription(normalized, skillName);
    return `---\nname: ${skillName}\ndescription: ${quoteYAMLValue(desc)}\n---\n\n${normalized}`;
  }

  const endIdx = normalized.indexOf("---", 3);
  if (endIdx === -1) return normalized;

  let fmBlock = normalized.substring(3, endIdx);
  const body = normalized.substring(endIdx + 3);

  for (const pattern of CLAUDE_FIELD_PATTERNS) {
    fmBlock = fmBlock.replace(new RegExp(pattern.source, pattern.flags), "");
  }

  // Collapse consecutive blank lines left by field removal
  fmBlock = fmBlock.replace(/\n{3,}/g, "\n\n");

  if (!HAS_NAME_RE.test(fmBlock)) {
    // Leading \n ensures separation from opening ---
    fmBlock = `\nname: ${skillName}${fmBlock}`;
  }

  return `---${fmBlock}---${body}`;
}
