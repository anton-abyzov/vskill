import type { BuildSkillMdInput } from "./skill-create-routes.js";

/**
 * Build SKILL.md content from form fields.
 *
 * Frontmatter shape is aligned with the canonical agentskills.io specification
 * (https://agentskills.io/specification). In particular, `version`, `tags` and
 * `target-agents` are emitted under a `metadata:` block — NEVER at the top
 * level. See 0679-skills-spec-compliance for the increment that introduced
 * this shape and the golden-file guardrails.
 *
 * Key order is stabilized: name → description → allowed-tools → model → metadata.
 *
 * 0679 F-005: `name:` is emitted at the top level when `data.name` is set.
 * The body's `# /<name>` heading remains as a human-readable signpost; the
 * frontmatter `name:` is what spec-aware tooling and validators consume.
 */
export function buildSkillMd(data: BuildSkillMdInput): string {
  const lines: string[] = ["---"];
  if (data.name?.trim()) {
    lines.push(`name: ${data.name.trim()}`);
  }
  // Description — always quote to handle special chars.
  // Newlines inside descriptions break YAML parsers, so collapse them to a
  // single space before escaping double quotes.
  const safeDescription = data.description
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, '\\"');
  lines.push(`description: "${safeDescription}"`);
  // 0728: Version is ALWAYS emitted. Defaults to "1.0.0" so no caller can
  // produce a versionless SKILL.md. Explicit values from callers win.
  const resolvedVersion = data.version?.trim() || "1.0.0";
  if (data.allowedTools?.trim()) {
    lines.push(`allowed-tools: ${data.allowedTools.trim()}`);
  }
  if (data.model) {
    lines.push(`model: ${data.model}`);
  }

  // Spec-compliant metadata block — tags and target-agents live HERE, not at root.
  const hasTags = Array.isArray(data.tags) && data.tags.length > 0;
  const hasAgents = Array.isArray(data.targetAgents) && data.targetAgents.length > 0;
  // 0734: persist authoring engine in metadata so future updates know how the
  // skill was produced. "none" → omit entirely (caller authored raw).
  const hasEngine = data.engine === "vskill" || data.engine === "anthropic-skill-creator";
  lines.push("metadata:");
  lines.push(`  version: "${resolvedVersion}"`);
  if (hasEngine) {
    lines.push(`  engine: ${data.engine}`);
  }
  if (hasTags) {
    lines.push("  tags:");
    for (const t of data.tags!) lines.push(`    - ${t}`);
  }
  if (hasAgents) {
    lines.push("  target-agents:");
    for (const a of data.targetAgents!) lines.push(`    - ${a}`);
  }

  lines.push("---");
  lines.push("");

  if (data.body.trim()) {
    lines.push(data.body.trim());
  } else {
    lines.push(`# /${data.name}`);
    lines.push("");
    lines.push("You are a helpful assistant. Describe what this skill does.");
  }

  return lines.join("\n") + "\n";
}

