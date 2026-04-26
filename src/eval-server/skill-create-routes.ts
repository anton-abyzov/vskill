// ---------------------------------------------------------------------------
// skill-create-routes.ts -- Skill creation & project layout detection
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { join, basename, resolve, sep } from "node:path";
import type { Router } from "./router.js";
import { isSkillCreatorInstalled } from "../utils/skill-creator-detection.js";
import { sendJson, readBody } from "./router.js";
import type { ProviderName } from "../eval/llm.js";
import { detectAvailableProviders, parseSkillFrontmatter } from "./api-routes.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { classifyError } from "./error-classifier.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";
import { getAgentCreationProfile } from "../agents/agents-registry.js";
import type { AgentCreationProfile } from "../agents/agents-registry.js";
import { generateSkill } from "../core/skill-generator.js";
import { extractFrontmatterVersion, bumpPatch, setFrontmatterVersion } from "../utils/version.js";
import { submitSkillUpdateEvent } from "./platform-proxy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DetectedLayout {
  layout: 1 | 2 | 3 | 4;
  label: string;
  pathTemplate: string;
  existingPlugins: string[];
}

interface ProjectLayoutResponse {
  root: string;
  detectedLayouts: DetectedLayout[];
  suggestedLayout: 1 | 2 | 3;
  existingSkills: Array<{ plugin: string; skill: string }>;
}

interface AiGenerationMeta {
  prompt: string;
  provider: string;
  model: string;
  reasoning: string;
}

/**
 * Authoring engine for the skill (0734). Three first-class peer choices:
 *   - "vskill" (default): VSkill skill-builder, cross-universal across 8 agents.
 *   - "anthropic-skill-creator": Anthropic's built-in plugin, richer Claude-native
 *     schema, Claude-only. Requires the `skill-creator` plugin installed locally.
 *   - "none": skip engine assistance, emit the request body verbatim. The
 *     `metadata.engine` frontmatter key is omitted entirely.
 *
 * Anthropic and VSkill are peer engines, NOT a fallback chain — the trade-off
 * is "richer Claude-native expressiveness" vs. "portable cross-tool output".
 */
export type CreateSkillEngine = "vskill" | "anthropic-skill-creator" | "none";

const VALID_ENGINES: ReadonlySet<string> = new Set<CreateSkillEngine>([
  "vskill",
  "anthropic-skill-creator",
  "none",
]);

interface CreateSkillRequest {
  name: string;
  plugin: string;
  layout: 1 | 2 | 3;
  description: string;
  model?: string;
  allowedTools?: string;
  body: string;
  /** Authoring engine — see CreateSkillEngine. Defaults to "vskill". */
  engine?: CreateSkillEngine;
  /**
   * Explicit `version:` to emit in SKILL.md frontmatter. When omitted:
   *   - mode="create" → defaults to "1.0.0"
   *   - mode="update" → existing version is read from disk and patch-bumped
   */
  version?: string;
  /**
   * "create" (default) → fail with 409 if SKILL.md already exists (preserves
   * the legacy guard that prevents accidental overwrite).
   * "update" → overwrite the existing SKILL.md with the new content, bumping
   * the patch version unless `version` is explicitly provided.
   */
  mode?: "create" | "update";
  /**
   * Spec-compliant (agentskills.io/specification): emitted under `metadata.tags`
   * in SKILL.md frontmatter, NEVER at the top level. Optional.
   */
  tags?: string[];
  /**
   * Spec-compliant (agentskills.io/specification): emitted under
   * `metadata.target-agents` in SKILL.md frontmatter, NEVER at the top level.
   * Optional.
   */
  targetAgents?: string[];
  evals?: Array<{
    id: number;
    name: string;
    prompt: string;
    expected_output: string;
    assertions: Array<{ id: string; text: string; type: string }>;
  }>;
  aiMeta?: AiGenerationMeta;
  draftDir?: string;
}

interface SaveDraftRequest extends CreateSkillRequest {
  aiMeta: AiGenerationMeta;
}

export interface PluginSuggestion {
  plugin: string;
  layout: 1 | 2;
  confidence: "high" | "medium" | "low";
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXCLUDE_DIRS = new Set([
  "skills", "plugins", "node_modules", ".git", ".specweave",
  "dist", "evals", ".claude", ".cursor", ".agents", "coverage",
]);

/** List subdirs of a skills/ dir that contain SKILL.md */
function listSkillDirs(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md")))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Detect project layout — mirrors scanSkills() logic from skill-scanner.ts */
// TODO(0670 T-001): relocate to src/core/project-layout.ts in a follow-up
// increment. Exported here (approach b) so src/core/skill-generator.ts can
// import without the full-move diff.
export function detectProjectLayout(root: string): ProjectLayoutResponse {
  const layouts: DetectedLayout[] = [];
  const allSkills: Array<{ plugin: string; skill: string }> = [];

  // Layout 4: Self — root IS the skill
  if (existsSync(join(root, "SKILL.md"))) {
    layouts.push({
      layout: 4,
      label: "Self (root is the skill)",
      pathTemplate: `${root}/SKILL.md`,
      existingPlugins: [],
    });
  }

  // Layout 3: Root skills/ directory
  const rootSkillsDir = join(root, "skills");
  if (existsSync(rootSkillsDir)) {
    const skills = listSkillDirs(rootSkillsDir);
    const pluginName = basename(root) || "default";
    layouts.push({
      layout: 3,
      label: "Root skills/",
      pathTemplate: "{root}/skills/{skill}/",
      existingPlugins: [pluginName],
    });
    for (const s of skills) allSkills.push({ plugin: pluginName, skill: s });
  }

  // Layout 1: Direct plugin dirs — {root}/{plugin}/skills/{skill}/
  const directPlugins: string[] = [];
  try {
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !EXCLUDE_DIRS.has(d.name) && !d.name.startsWith("."));
    for (const entry of entries) {
      const skillsPath = join(root, entry.name, "skills");
      if (existsSync(skillsPath)) {
        directPlugins.push(entry.name);
        const skills = listSkillDirs(skillsPath);
        for (const s of skills) allSkills.push({ plugin: entry.name, skill: s });
      }
    }
  } catch { /* ignore */ }

  if (directPlugins.length > 0) {
    layouts.push({
      layout: 1,
      label: "Direct plugins",
      pathTemplate: "{root}/{plugin}/skills/{skill}/",
      existingPlugins: directPlugins,
    });
  }

  // Layout 2: Nested plugins/ dir — {root}/plugins/{plugin}/skills/{skill}/
  const pluginsDir = join(root, "plugins");
  if (existsSync(pluginsDir)) {
    const nestedPlugins: string[] = [];
    try {
      const entries = readdirSync(pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      for (const entry of entries) {
        const skillsPath = join(pluginsDir, entry.name, "skills");
        if (existsSync(skillsPath)) {
          nestedPlugins.push(entry.name);
          const skills = listSkillDirs(skillsPath);
          for (const s of skills) allSkills.push({ plugin: entry.name, skill: s });
        }
      }
    } catch { /* ignore */ }

    if (nestedPlugins.length > 0) {
      layouts.push({
        layout: 2,
        label: "Nested plugins/",
        pathTemplate: "{root}/plugins/{plugin}/skills/{skill}/",
        existingPlugins: nestedPlugins,
      });
    }
  }

  // Suggestion priority: Layout 2 > Layout 1 > Layout 3
  let suggestedLayout: 1 | 2 | 3 = 3;
  if (layouts.find((l) => l.layout === 2)) suggestedLayout = 2;
  else if (layouts.find((l) => l.layout === 1)) suggestedLayout = 1;

  return { root, detectedLayouts: layouts, suggestedLayout, existingSkills: allSkills };
}

/**
 * Build SKILL.md content from form fields.
 *
 * Frontmatter shape is aligned with the canonical agentskills.io specification
 * (https://agentskills.io/specification). In particular, `tags` and
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
function buildSkillMd(data: CreateSkillRequest): string {
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
  lines.push(`version: "${resolvedVersion}"`);
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
  if (hasTags || hasAgents || hasEngine) {
    lines.push("metadata:");
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

// ---------------------------------------------------------------------------
// Test-friendly exports (used by 0679 golden-file tests and the
// scripts/validate-skills-spec.ts lint target). Not intended for runtime use.
// ---------------------------------------------------------------------------

export interface BuildSkillMdInput {
  name: string;
  plugin: string;
  layout: 1 | 2 | 3;
  description: string;
  /** Frontmatter `version:`. Defaults to "1.0.0" when omitted or empty. */
  version?: string;
  /** 0734: authoring engine emitted under metadata.engine. */
  engine?: CreateSkillEngine;
  model?: string;
  allowedTools?: string;
  body: string;
  tags?: string[];
  targetAgents?: string[];
}

/**
 * Public alias of the private `buildSkillMd` emitter for tests and lint scripts.
 * The underlying function is the source of truth; this export exists so
 * golden-file tests and the CI validator can exercise the emitter without
 * touching the HTTP route.
 *
 * @internal — tests must import from `__tests__/helpers/skill-md-test-helpers.ts`,
 *   not from this module. Production code MUST NOT call this.
 */
export function buildSkillMdForTest(data: BuildSkillMdInput): string {
  return buildSkillMd(data as CreateSkillRequest);
}

/**
 * Minimal YAML frontmatter parser for test assertions — supports the shape
 * emitted by `buildSkillMd`:
 *   - top-level scalars (quoted or unquoted)
 *   - `metadata:` block with `tags:` and `target-agents:` list children
 *
 * This is intentionally narrow. For general YAML, callers should use a real
 * parser. Exported solely to avoid adding a YAML dep to the test target.
 *
 * @internal — production reads MUST go through `parseSkillFrontmatter`
 *   in api-routes.ts. Tests must import this via
 *   `__tests__/helpers/skill-md-test-helpers.ts`.
 */
export function parseFrontmatterForTest(content: string): Record<string, unknown> & { metadata: Record<string, unknown> } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { metadata: {} };
  const body = match[1];
  const rootOut: Record<string, unknown> = {};
  const metadataOut: Record<string, unknown> = {};
  const lines = body.split("\n");

  let i = 0;
  let inMetadata = false;
  let currentListKey: string | null = null;
  let currentList: string[] | null = null;
  let currentListScope: "root" | "metadata" | null = null;

  const flushList = () => {
    if (currentListKey && currentList) {
      if (currentListScope === "metadata") metadataOut[currentListKey] = currentList;
      else rootOut[currentListKey] = currentList;
    }
    currentListKey = null;
    currentList = null;
    currentListScope = null;
  };

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === "") { i++; continue; }

    // Metadata nested list item: `    - value`
    if (/^ {4}- /.test(raw) && currentList && currentListScope === "metadata") {
      currentList.push(raw.replace(/^ {4}- /, "").trim());
      i++; continue;
    }
    // Top-level list item: `  - value`
    if (/^ {2}- /.test(raw) && currentList && currentListScope === "root") {
      currentList.push(raw.replace(/^ {2}- /, "").trim());
      i++; continue;
    }

    // Metadata child key: `  key:` or `  key: value`
    const metaChildMatch = raw.match(/^ {2}([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (inMetadata && metaChildMatch) {
      flushList();
      const key = metaChildMatch[1];
      const value = metaChildMatch[2];
      if (value === "") {
        currentListKey = key;
        currentList = [];
        currentListScope = "metadata";
      } else {
        metadataOut[key] = stripQuotes(value);
      }
      i++; continue;
    }

    // Top-level key: `key:` or `key: value`
    const topMatch = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (topMatch) {
      flushList();
      const key = topMatch[1];
      const value = topMatch[2];
      if (key === "metadata") {
        inMetadata = true;
        i++; continue;
      }
      inMetadata = false;
      if (value === "") {
        currentListKey = key;
        currentList = [];
        currentListScope = "root";
      } else {
        rootOut[key] = stripQuotes(value);
      }
      i++; continue;
    }

    i++;
  }
  flushList();

  return Object.assign(rootOut, { metadata: metadataOut }) as Record<string, unknown> & { metadata: Record<string, unknown> };
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

// ---------------------------------------------------------------------------
// `skills-ref validate` post-creation helper (0679, US-003 / T-004 + T-005)
//
// The helpers below are a pure interpretation layer over a `spawnSync`-style
// result. Keeping them pure makes the four scenarios from AC-US3-01..04
// directly testable without stubbing child processes: a caller (route
// handler, future CLI post-creation hook) runs `spawnSync("skills-ref",
// ["validate", path])` and hands the result to `interpretValidatorResult`.
//
// Behavior (see plan.md §4):
//   - exit 0                    → success, silent
//   - exit non-zero, non-strict → warning, exit code stays 0
//   - exit non-zero, strict     → error, overall exit code becomes 1
//   - ENOENT (binary missing)   → one-line install hint, exit stays 0
//                                 (CI enforces via lint:skills-spec instead)
// ---------------------------------------------------------------------------

export interface SpawnResultLike {
  status: number | null;
  stdout: string;
  stderr: string;
  error: (NodeJS.ErrnoException | Error) | undefined;
}

export interface ValidatorOptions {
  strict: boolean;
}

export interface ValidatorOutcome {
  ok: boolean;
  exitCode: 0 | 1;
  kind: "success" | "warning" | "error" | "missing-binary";
  messages: string[];
  skillPath: string;
}

function extractMessages(res: SpawnResultLike): string[] {
  const raw = (res.stderr && res.stderr.trim()) || (res.stdout && res.stdout.trim()) || "";
  if (!raw) return [`skills-ref exited with code ${res.status ?? "unknown"}`];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Interpret a `spawnSync("skills-ref", ["validate", path])` result into a
 * structured outcome. Pure function — no side effects, no I/O.
 */
export function interpretValidatorResult(
  skillPath: string,
  res: SpawnResultLike,
  opts: ValidatorOptions,
): ValidatorOutcome {
  // Missing binary — always non-blocking (graceful degradation).
  const errCode = (res.error as NodeJS.ErrnoException | undefined)?.code;
  if (errCode === "ENOENT") {
    return {
      ok: true,
      exitCode: 0,
      kind: "missing-binary",
      messages: ["Install `skills-ref` to enable spec validation: `npm i -g skills-ref`"],
      skillPath,
    };
  }

  // Happy path.
  if (res.status === 0) {
    return { ok: true, exitCode: 0, kind: "success", messages: [], skillPath };
  }

  // Non-zero exit.
  const messages = extractMessages(res);
  if (opts.strict) {
    return { ok: false, exitCode: 1, kind: "error", messages, skillPath };
  }
  return { ok: true, exitCode: 0, kind: "warning", messages, skillPath };
}

/**
 * Render a `ValidatorOutcome` to a human-readable string for CLI / server
 * log surfaces. Empty string on success (silent). Pure function.
 *
 * Color handling is deliberately omitted here — callers that want ANSI
 * colors wrap the returned string with their own formatter. That keeps the
 * helper trivially testable.
 */
export function formatValidatorReport(outcome: ValidatorOutcome): string {
  switch (outcome.kind) {
    case "success":
      return "";
    case "missing-binary":
      return outcome.messages[0] + "\n";
    case "warning": {
      const lines = [
        `Validation warnings for ${outcome.skillPath}:`,
        ...outcome.messages.map((m) => `  - ${m}`),
        "",
        "Skill file remains on disk. Spec: https://agentskills.io/specification",
      ];
      return lines.join("\n") + "\n";
    }
    case "error": {
      const lines = [
        `Validation failed for ${outcome.skillPath}:`,
        ...outcome.messages.map((m) => `  - ${m}`),
        "",
        "Skill file remains on disk. Re-run without --strict to warn instead of block.",
      ];
      return lines.join("\n") + "\n";
    }
  }
}

/** Compute target directory for a new skill based on layout */
function computeSkillDir(root: string, layout: 1 | 2 | 3, plugin: string, name: string): string {
  switch (layout) {
    case 1: return join(root, plugin, "skills", name);
    case 2: return join(root, "plugins", plugin, "skills", name);
    case 3: return join(root, "skills", name);
  }
}

/**
 * Check if a resolved path is strictly within a root directory.
 * Uses trailing separator to prevent prefix collision (e.g., /project vs /project-evil).
 */
export function isDraftWithinRoot(draftPath: string, root: string): boolean {
  const resolvedRoot = resolve(root) + sep;
  const resolvedDraft = resolve(draftPath);
  return resolvedDraft.startsWith(resolvedRoot) && resolvedDraft !== resolve(root);
}

/**
 * Match a newly generated skill against existing plugins by tag/keyword overlap.
 * Returns the best-matching plugin if score exceeds threshold, or null.
 */
export function matchExistingPlugin(
  skillName: string,
  skillDescription: string,
  skillTags: string[],
  root: string,
): PluginSuggestion | null {
  const layout = detectProjectLayout(root);
  const pluginSkills = new Map<string, { layout: 1 | 2; tags: Set<string>; keywords: Set<string> }>();

  // Gather existing plugin metadata from detected layouts
  for (const detected of layout.detectedLayouts) {
    if (detected.layout !== 1 && detected.layout !== 2) continue;
    for (const pluginName of detected.existingPlugins) {
      if (pluginSkills.has(pluginName)) continue;
      const tags = new Set<string>();
      const keywords = new Set<string>();

      // Read SKILL.md frontmatter from each skill in this plugin
      const skillsDirPath = detected.layout === 1
        ? join(root, pluginName, "skills")
        : join(root, "plugins", pluginName, "skills");

      const skillDirs = listSkillDirs(skillsDirPath);
      for (const skillDir of skillDirs) {
        const mdPath = join(skillsDirPath, skillDir, "SKILL.md");
        try {
          const content = readFileSync(mdPath, "utf-8");
          // 0679 F-001: route through parseSkillFrontmatter so the canonical
          // metadata-nested tags shape (per agentskills.io/specification) is
          // honored. The legacy regex (`^---[\s\S]*?tags:\s*(.+)`) only saw
          // top-level `tags:` and silently produced empty tags for newly
          // emitted SKILL.md files — a silent plugin-matching regression.
          const fm = parseSkillFrontmatter(content);
          const fmTags = fm.tags;
          const tagList: string[] = Array.isArray(fmTags)
            ? fmTags.filter((t): t is string => typeof t === "string")
            : (typeof fmTags === "string"
              ? fmTags.split(",")
              : []);
          for (const raw of tagList) {
            const t = raw.trim().toLowerCase();
            if (t) tags.add(t);
          }
          const fmDesc = fm.description;
          if (typeof fmDesc === "string") {
            for (const w of fmDesc.toLowerCase().split(/\s+/).filter((w) => w.length > 3)) {
              keywords.add(w);
            }
          }
        } catch { /* skip unreadable */ }
      }

      // Also add plugin name segments as keywords
      for (const seg of pluginName.split(/[-_.]/).filter(Boolean)) {
        keywords.add(seg.toLowerCase());
      }

      pluginSkills.set(pluginName, { layout: detected.layout as 1 | 2, tags, keywords });
    }
  }

  if (pluginSkills.size === 0) return null;

  const inputTags = new Set(skillTags.map((t) => t.toLowerCase()));
  const inputKeywords = new Set(
    skillDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );
  // Add skill name segments
  for (const seg of skillName.split(/[-_.]/).filter(Boolean)) {
    inputKeywords.add(seg.toLowerCase());
  }

  let bestPlugin: string | null = null;
  let bestScore = 0;
  let bestLayout: 1 | 2 = 1;
  let bestReason = "";

  for (const [pluginName, data] of pluginSkills) {
    let score = 0;
    const matchingTags: string[] = [];
    const matchingKeywords: string[] = [];

    // Tag overlap (weighted heavily)
    for (const tag of inputTags) {
      if (data.tags.has(tag)) {
        score += 3;
        matchingTags.push(tag);
      }
    }

    // Keyword overlap
    for (const kw of inputKeywords) {
      if (data.keywords.has(kw)) {
        score += 1;
        matchingKeywords.push(kw);
      }
    }

    // Plugin name similarity: shared segments (e.g. "browser-automation" ↔ "browser-screenshot")
    const pluginSegs = new Set(pluginName.toLowerCase().split(/[-_.]/).filter(Boolean));
    const skillSegs = new Set(skillName.toLowerCase().split(/[-_.]/).filter(Boolean));
    let sharedSegs = 0;
    for (const seg of skillSegs) {
      if (pluginSegs.has(seg)) sharedSegs++;
    }
    if (sharedSegs > 0) score += sharedSegs * 2;

    if (score > bestScore) {
      bestScore = score;
      bestPlugin = pluginName;
      bestLayout = data.layout;
      const parts: string[] = [];
      if (matchingTags.length > 0) parts.push(`${matchingTags.length} matching tags: ${matchingTags.join(", ")}`);
      if (matchingKeywords.length > 0) parts.push(`${matchingKeywords.length} keyword overlaps`);
      bestReason = parts.join("; ") || "name similarity";
    }
  }

  if (!bestPlugin || bestScore < 2) return null;

  const confidence: "high" | "medium" | "low" = bestScore >= 6 ? "high" : bestScore >= 3 ? "medium" : "low";

  return {
    plugin: bestPlugin,
    layout: bestLayout,
    confidence,
    reason: bestReason,
  };
}

// ---------------------------------------------------------------------------
// AI skill generation
// ---------------------------------------------------------------------------

// Shared best practices block used by both body and eval prompts
const SKILL_STUDIO_BEST_PRACTICES = `## Skill Studio Best Practices

### SKILL.md Anatomy
Every skill has YAML frontmatter (description required, name/model/allowed-tools optional) and a markdown body with instructions.

### Description Quality (Frontmatter) — CRITICAL
The description is the PRIMARY triggering mechanism. It must be "pushy" to combat undertriggering:
- Use third-person format: "This skill should be used when the user asks to..."
- Include specific trigger phrases users would say (e.g., "create X", "configure Y", "fix Z")
- Include explicit activation phrases: "Make sure to use this skill whenever the user mentions..."
- Be concrete and specific, not vague or generic
- BAD: "Provides guidance for working with X" (vague, no triggers)
- GOOD: "This skill should be used when the user asks to \\"create X\\", \\"configure Y\\", or \\"troubleshoot Z\\". Activate whenever the user mentions X-related tasks."

### Writing Style
- Use imperative/infinitive form (verb-first instructions), NOT second person
- Use objective, instructional language: "To accomplish X, do Y" not "You should do X"
- BAD: "You should start by reading the file" / "You need to validate"
- GOOD: "Start by reading the file" / "Validate the input before processing"
- Explain the WHY behind rules — LLMs respond better to reasoning than rigid MUST/NEVER

### Progressive Disclosure
- Keep SKILL.md lean: 500-2000 words ideal for body, under 500 lines total
- Core concepts and essential procedures in the body
- Structure with ## sections: Workflow, Rules, Output Format, Examples

### Content Quality
- Focus on procedural knowledge non-obvious to an AI assistant
- Include information that helps another AI instance execute tasks effectively
- Include concrete examples where helpful
- Include a clear Workflow section with numbered steps

### Common Mistakes to Avoid
- Weak trigger descriptions (vague, no specific phrases)
- Too much content without structure
- Second-person writing style
- Missing workflow section
- Overly generic instructions that don't add value

### Action-First Skills (Bash/tool-execution)
When a skill includes allowed-tools: Bash (or Read, Write, Edit), the skill body MUST:
- Open with an explicit execution directive: "Execute each step immediately. Run Bash commands directly — do not ask for permission or describe plans."
- Use "Step N — [action verb]. Run this immediately:" headers, not "Step N: [noun] Discovery"
- Every step must end with a concrete, complete, copy-pasteable code block — not prose describing what the code would do
- Include any variable values (paths, URLs, flags) directly in the code block, not as placeholders`;

// TODO(0670 T-001): relocate to src/core/skill-prompts.ts in a follow-up
// increment. Exported here (approach b) so src/core/skill-generator.ts can
// import without the full-move diff.
export const BODY_SYSTEM_PROMPT = `You are an expert AI skill engineer in Skill Studio. Given a user's description of what a skill should do, generate the SKILL.md body and metadata (NOT evals).

${SKILL_STUDIO_BEST_PRACTICES}

## Output Format
Return a JSON object with these fields:
{
  "name": "kebab-case-name",
  "description": "Third-person trigger description with specific activation phrases",
  "model": "",
  "allowedTools": "",
  "body": "# /skill-name\\n\\nFull system prompt with ## sections"
}

Field rules:
- name: kebab-case, concise, descriptive (e.g., "sql-formatter", "api-docs-generator")
- description: 1-3 sentences with trigger phrases. Must pass the "would Claude trigger on this?" test
- model: "" (any) unless task clearly requires opus-level reasoning or is trivially haiku-suitable
- allowedTools: comma-separated list (e.g., "Read, Write, Edit, Bash") or "" for unrestricted. Only restrict when the skill genuinely shouldn't use certain tools
- body: Complete markdown starting with # /skill-name, structured with ## sections, 500-2000 words

Return ONLY the JSON object — no code fences, no preamble.

After the JSON, on a new line, write "---REASONING---" followed by a brief explanation of your design choices (why this name, why these trigger phrases, what Skill Studio rules you applied).`;

// TODO(0670 T-001): relocate to src/core/skill-prompts.ts.
export const EVAL_SYSTEM_PROMPT = `You are an expert AI skill evaluator. Given a skill's name, description, and purpose, generate eval test cases that verify the skill works correctly.

### Eval Assertions for Action-Oriented Skills (CRITICAL)
The eval evaluates the LLM text response — it cannot run Bash or call tools. Assertions must check for code/commands present IN the response, not whether they were executed.
- BAD: "Runs a bash command to discover profiles" (implies execution — will always fail)
- GOOD: "Response includes a bash code block that lists Chrome profile directories"
- BAD: "Opens https://studio.youtube.com as the target URL"
- GOOD: "Response includes studio.youtube.com as the target URL in a code block or command"
- BAD: "Checks that the file exists before uploading"
- GOOD: "Response includes a bash command checking whether the file exists (e.g., using test -f or ls)"

### Assertion Quality: Functional Over Formatting (CRITICAL)
Assert on FUNCTIONAL correctness, not formatting or presentation details. Each assertion should test exactly ONE observable behavior (unit-test style).
- NEVER assert on: blank lines, paragraph count, whitespace, exact heading levels, bullet formatting, sentence count, or line breaks
- GOOD: "The response includes a greeting that contains the name 'Anton'" (checks functional behavior)
- BAD: "The greeting is a single short sentence (not multiple paragraphs)" (tests formatting, not function)
- GOOD: "The response lists at least 3 benefits of TypeScript" (checks content)
- BAD: "The response uses exactly 3 bullet points" (tests formatting)
Formatting is stylistic — it varies between LLM runs and does not indicate skill quality.

## Output Format
Return a JSON object with these fields:
{
  "evals": [
    {
      "id": 1,
      "name": "test case name",
      "prompt": "realistic user prompt",
      "expected_output": "description of correct behavior",
      "assertions": [
        { "id": "a1", "text": "objectively verifiable assertion", "type": "boolean" }
      ]
    }
  ]
}

Field rules:
- evals: 2-3 realistic test cases with objectively verifiable assertions
- Prompts should be what real users would say, not abstract test inputs
- Each assertion must be independently verifiable by a judge LLM reading the response text
- Each assertion should check exactly ONE functional behavior (unit-test granularity)

Return ONLY the JSON object — no code fences, no preamble.`;

// Keep the monolithic prompt for backward compatibility (used nowhere after refactor but exported for tests)
const GENERATE_SYSTEM_PROMPT = `You are an expert AI skill engineer in Skill Studio. Given a user's description of what a skill should do, generate a complete, production-quality skill definition.

${SKILL_STUDIO_BEST_PRACTICES}

### Eval Assertions for Action-Oriented Skills (CRITICAL)
The eval evaluates the LLM text response — it cannot run Bash or call tools. Assertions must check for code/commands present IN the response, not whether they were executed.
- BAD: "Runs a bash command to discover profiles" (implies execution — will always fail)
- GOOD: "Response includes a bash code block that lists Chrome profile directories"
- BAD: "Opens https://studio.youtube.com as the target URL"
- GOOD: "Response includes studio.youtube.com as the target URL in a code block or command"
- BAD: "Checks that the file exists before uploading"
- GOOD: "Response includes a bash command checking whether the file exists (e.g., using test -f or ls)"

## Output Format
Return a JSON object with these fields:
{
  "name": "kebab-case-name",
  "description": "Third-person trigger description with specific activation phrases",
  "model": "",
  "allowedTools": "",
  "body": "# /skill-name\\n\\nFull system prompt with ## sections",
  "evals": [
    {
      "id": 1,
      "name": "test case name",
      "prompt": "realistic user prompt",
      "expected_output": "description of correct behavior",
      "assertions": [
        { "id": "a1", "text": "objectively verifiable assertion", "type": "boolean" }
      ]
    }
  ]
}

Field rules:
- name: kebab-case, concise, descriptive (e.g., "sql-formatter", "api-docs-generator")
- description: 1-3 sentences with trigger phrases. Must pass the "would Claude trigger on this?" test
- model: "" (any) unless task clearly requires opus-level reasoning or is trivially haiku-suitable
- allowedTools: comma-separated list (e.g., "Read, Write, Edit, Bash") or "" for unrestricted. Only restrict when the skill genuinely shouldn't use certain tools
- body: Complete markdown starting with # /skill-name, structured with ## sections, 500-2000 words
- evals: 2-3 realistic test cases with objectively verifiable assertions. Prompts should be what real users would say, not abstract test inputs

Return ONLY the JSON object — no code fences, no preamble.

After the JSON, on a new line, write "---REASONING---" followed by a brief explanation of your design choices (why this name, why these trigger phrases, what Skill Studio rules you applied).`;

// ---------------------------------------------------------------------------
// Agent-aware prompt augmentation
// ---------------------------------------------------------------------------

/**
 * Build an agent-aware system prompt by conditionally appending a
 * "## Target Agent Constraints" section when non-Claude agents are targeted.
 *
 * When targetAgents is absent, empty, or only contains "claude-code",
 * the base prompt is returned unchanged (backward compatible).
 */
export function buildAgentAwareSystemPrompt(
  basePrompt: string,
  targetAgents: string[] | undefined,
): string {
  if (!targetAgents || targetAgents.length === 0) return basePrompt;

  // Collect profiles for non-Claude agents only
  const profiles: AgentCreationProfile[] = [];
  for (const agentId of targetAgents) {
    if (agentId === "claude-code") continue;
    const profile = getAgentCreationProfile(agentId);
    if (profile) profiles.push(profile);
  }

  if (profiles.length === 0) return basePrompt;

  // Aggregate agent names and constraints
  const agentNames = profiles.map((p) => p.agent.displayName).join(", ");

  // Build feature matrix
  const featureLines = profiles.map((p) => {
    const fs = p.featureSupport;
    return `- ${p.agent.displayName}: slashCommands=${fs.slashCommands}, hooks=${fs.hooks}, mcp=${fs.mcp}, customSystemPrompt=${fs.customSystemPrompt}`;
  });

  // Deduplicate guidance across all profiles
  const allGuidance = new Set<string>();
  for (const p of profiles) {
    for (const g of p.addGuidance) allGuidance.add(g);
  }

  if (allGuidance.size === 0) return basePrompt;

  const constraintSection = [
    "",
    "## Target Agent Constraints",
    "",
    `This skill targets: ${agentNames}`,
    "",
    "Feature availability for target agents:",
    ...featureLines,
    "",
    "IMPORTANT CONSTRAINTS:",
    ...[...allGuidance].map((g) => `- ${g}`),
    "",
    "Generate a skill body that works across ALL target agents by using only universally available features.",
  ].join("\n");

  return basePrompt + constraintSection;
}

export interface GenerateSkillRequest {
  prompt: string;
  provider?: ProviderName;
  model?: string;
  targetAgents?: string[];
}

export interface GenerateSkillResult {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
  evals: Array<{
    id: number;
    name: string;
    prompt: string;
    expected_output: string;
    assertions: Array<{ id: string; text: string; type: string }>;
  }>;
  reasoning: string;
  warning?: string;
}

/** Strip code fences and parse JSON from raw LLM output */
function cleanAndParseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("AI response was not valid JSON. Try again or use manual mode.");
  }
}

export interface BodyResult {
  name: string;
  description: string;
  model: string;
  allowedTools: string;
  body: string;
  reasoning: string;
}

type EvalItem = GenerateSkillResult["evals"][number];

export interface EvalsResult {
  evals: EvalItem[];
}

export function parseBodyResponse(raw: string): BodyResult {
  const parts = raw.split("---REASONING---");
  const jsonPart = parts[0].trim();
  const reasoning = parts.length > 1 ? parts[1].trim() : "Skill generated using Skill Studio best practices.";

  const parsed = cleanAndParseJson(jsonPart);
  const name = String(parsed.name || "").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("AI returned an invalid skill name. Try again or use manual mode.");

  return {
    name,
    description: String(parsed.description || ""),
    model: String(parsed.model || ""),
    allowedTools: String(parsed.allowedTools || ""),
    body: String(parsed.body || ""),
    reasoning,
  };
}

export function parseEvalsResponse(raw: string): EvalsResult {
  const jsonPart = raw.trim();
  const parsed = cleanAndParseJson(jsonPart);
  const evals = Array.isArray(parsed.evals) ? (parsed.evals as EvalItem[]).slice(0, 10) : [];
  return { evals };
}

export function mergeGenerateResults(
  bodySettled: PromiseSettledResult<BodyResult>,
  evalsSettled: PromiseSettledResult<EvalsResult>,
): GenerateSkillResult {
  // Body is required — if it failed, propagate the error
  if (bodySettled.status === "rejected") {
    throw bodySettled.reason instanceof Error
      ? bodySettled.reason
      : new Error(String(bodySettled.reason));
  }

  const bodyResult = bodySettled.value;

  // Evals are optional — if they failed, return body with empty evals and warning
  if (evalsSettled.status === "rejected") {
    const reason = evalsSettled.reason instanceof Error
      ? evalsSettled.reason.message
      : String(evalsSettled.reason);
    return {
      ...bodyResult,
      evals: [],
      warning: `eval generation failed: ${reason}`,
    };
  }

  return {
    ...bodyResult,
    evals: evalsSettled.value.evals,
  };
}

/** Legacy monolithic parser — still used as fallback */
function parseGenerateResponse(raw: string): GenerateSkillResult {
  const parts = raw.split("---REASONING---");
  const jsonPart = parts[0].trim();
  const reasoning = parts.length > 1 ? parts[1].trim() : "Skill generated using Skill Studio best practices.";

  const parsed = cleanAndParseJson(jsonPart);
  const name = String(parsed.name || "").replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
  if (!name) throw new Error("AI returned an invalid skill name. Try again or use manual mode.");

  return {
    name,
    description: String(parsed.description || ""),
    model: String(parsed.model || ""),
    allowedTools: String(parsed.allowedTools || ""),
    body: String(parsed.body || ""),
    evals: Array.isArray(parsed.evals) ? (parsed.evals as GenerateSkillResult["evals"]).slice(0, 10) : [],
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// 0670 T-002 — transport-layer helpers for POST /api/skills/generate
// ---------------------------------------------------------------------------

/**
 * Resolve + validate { provider, model } against detectAvailableProviders()
 * (0678 contract — see AC-US2-01..05). Returns either a resolved pair or a
 * 400 payload; callers send the payload as plain JSON (NOT SSE).
 */
interface ResolvedProviderModel {
  ok: true;
  provider: string;
  model: string;
}
interface ProviderModelError {
  ok: false;
  error: "unknown_provider" | "unknown_model";
  validProviders?: string[];
  validModels?: string[];
}

/**
 * Merge generator output with a `suggestedPlugin` computed from the existing
 * plugins on disk. Kept out of src/core/skill-generator.ts so the generator
 * stays pure (no filesystem access for plugin suggestion).
 */
function attachSuggestedPlugin(parsed: GenerateSkillResult, root: string) {
  const tags = parsed.description
    ? parsed.description.toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const suggestedPlugin = matchExistingPlugin(parsed.name, parsed.description, tags, root);
  return { ...parsed, suggestedPlugin };
}

async function resolveProviderModel(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
): Promise<ResolvedProviderModel | ProviderModelError> {
  // Both absent → legacy default (no probe).
  if (!requestedProvider && !requestedModel) {
    return { ok: true, provider: "claude-cli", model: "sonnet" };
  }

  const detected = await detectAvailableProviders();
  const requested = requestedProvider || "claude-cli";
  const match = detected.find((p) => p.id === requested);
  if (!match) {
    return {
      ok: false,
      error: "unknown_provider",
      validProviders: detected.map((p) => p.id),
    };
  }

  const validModelIds = match.models.map((m) => m.id);
  if (requestedModel !== undefined) {
    if (!validModelIds.includes(requestedModel)) {
      return { ok: false, error: "unknown_model", validModels: validModelIds };
    }
    return { ok: true, provider: requested, model: requestedModel };
  }
  // Provider given, model omitted — pick the first model id for that provider.
  return { ok: true, provider: requested, model: validModelIds[0] ?? "sonnet" };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSkillCreateRoutes(router: Router, root: string): void {
  // GET /api/project-layout — detect project layout and suggest placement
  router.get("/api/project-layout", async (_req, res) => {
    try {
      const layout = detectProjectLayout(root);
      sendJson(res, layout, 200, _req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, _req);
    }
  });

  // POST /api/skills/create — create a new skill
  router.post("/api/skills/create", async (req, res) => {
    const body = (await readBody(req)) as CreateSkillRequest;

    // Validate name
    if (!body.name || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.name)) {
      sendJson(res, { error: "Name must be kebab-case (lowercase letters, numbers, hyphens)" }, 400, req);
      return;
    }
    if (!body.description?.trim()) {
      sendJson(res, { error: "Description is required" }, 400, req);
      return;
    }
    if (!body.layout || ![1, 2, 3].includes(body.layout)) {
      sendJson(res, { error: "Layout must be 1, 2, or 3" }, 400, req);
      return;
    }
    if (body.layout !== 3 && !body.plugin?.trim()) {
      sendJson(res, { error: "Plugin name is required for this layout" }, 400, req);
      return;
    }
    if (body.plugin && !/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(body.plugin)) {
      sendJson(res, { error: "Plugin name contains invalid characters" }, 400, req);
      return;
    }

    // 0734: validate authoring engine. Default to "vskill" when omitted.
    const engine: CreateSkillEngine = (body.engine ?? "vskill") as CreateSkillEngine;
    if (body.engine !== undefined && !VALID_ENGINES.has(body.engine)) {
      sendJson(res, {
        error: `Invalid engine: ${body.engine}. Must be one of: vskill, anthropic-skill-creator, none.`,
      }, 400, req);
      return;
    }
    if (engine === "anthropic-skill-creator" && !isSkillCreatorInstalled(root)) {
      sendJson(res, {
        error: "skill-creator-not-installed",
        remediation: "claude plugin install skill-creator",
      }, 400, req);
      return;
    }

    const targetDir = computeSkillDir(root, body.layout, body.plugin || "", body.name);
    const skillMdPath = join(targetDir, "SKILL.md");

    // Check if already exists. Three legitimate ways to overwrite:
    //   1. draft.json marker → finalizing an auto-saved draft
    //   2. mode === "update" → caller intentionally wants to overwrite
    //   3. (otherwise) → 409 Conflict (legacy guard)
    const isDraftFinalize = existsSync(join(targetDir, "draft.json"));
    const isUpdateMode = body.mode === "update";
    const skillExists = existsSync(skillMdPath);

    if (skillExists && !isDraftFinalize && !isUpdateMode) {
      sendJson(res, { error: `Skill already exists at ${targetDir}` }, 409, req);
      return;
    }

    // Resolve the version to emit in SKILL.md.
    //   - explicit body.version always wins
    //   - update mode reads the existing version + bumps patch
    //   - everything else defaults to "1.0.0"
    let resolvedVersion: string;
    if (body.version?.trim()) {
      resolvedVersion = body.version.trim();
    } else if (skillExists && isUpdateMode) {
      const existing = readFileSync(skillMdPath, "utf-8");
      const previous = extractFrontmatterVersion(existing) ?? "1.0.0";
      resolvedVersion = bumpPatch(previous);
    } else {
      resolvedVersion = "1.0.0";
    }

    try {
      // Create directories
      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, "evals"), { recursive: true });

      // Write SKILL.md (with resolved version + validated engine).
      const content = buildSkillMd({ ...body, version: resolvedVersion, engine });
      writeFileSync(skillMdPath, content, "utf-8");

      // Write evals.json if provided (from AI generation)
      if (body.evals && body.evals.length > 0) {
        const evalsData = {
          skill_name: body.name,
          evals: body.evals,
        };
        writeFileSync(
          join(targetDir, "evals", "evals.json"),
          JSON.stringify(evalsData, null, 2) + "\n",
          "utf-8",
        );

        // Record history entry for AI-generated skill (skip if draft finalization — already written by save-draft)
        if (!isDraftFinalize) {
          const aiMeta = body.aiMeta;
          try {
            await writeHistoryEntry(targetDir, {
              timestamp: new Date().toISOString(),
              model: aiMeta?.model || "unknown",
              skill_name: body.name,
              cases: [],
              overall_pass_rate: undefined,
              type: "ai-generate",
              provider: aiMeta?.provider || "unknown",
              generate: { prompt: aiMeta?.prompt || body.description, result: content },
            });
          } catch { /* history write failure should not break the main response */ }
        }
      }

      // Finalize: remove draft.json if it exists (draft → final)
      const draftPath = join(targetDir, "draft.json");
      if (existsSync(draftPath)) {
        try { unlinkSync(draftPath); } catch { /* ignore */ }
      }

      // Clean up old draft directory if plugin was changed
      if (body.draftDir) {
        const resolvedDraft = resolve(root, body.draftDir);
        if (isDraftWithinRoot(resolvedDraft, root) && resolvedDraft !== resolve(targetDir)) {
          try { rmSync(resolvedDraft, { recursive: true, force: true }); } catch { /* non-blocking */ }
        }
      }

      // In update mode, attempt to publish the new version to the platform's
      // queue so SSE subscribers see it without waiting for the 10-min scanner.
      // No-op when INTERNAL_BROADCAST_KEY is not configured (production studio).
      let publishResult: Awaited<ReturnType<typeof submitSkillUpdateEvent>> | undefined;
      if (skillExists && isUpdateMode) {
        const pluginForId = body.layout === 3 ? (basename(root) || "default") : (body.plugin || "default");
        publishResult = await submitSkillUpdateEvent({
          skillId: `${pluginForId}/${body.name}`,
          version: resolvedVersion,
          diffSummary: `skills/create update mode: ${body.name} → ${resolvedVersion}`,
        });
      }

      const isUpdate = skillExists && isUpdateMode;
      // Anthropic skill-creator emits Claude-only by definition; VSkill/none
      // are universal across the registered universal targets.
      const emittedTargets = engine === "anthropic-skill-creator" ? ["claude-code"] : null;
      sendJson(res, {
        ok: true,
        plugin: body.layout === 3 ? (basename(root) || "default") : body.plugin,
        skill: body.name,
        dir: targetDir,
        skillMdPath,
        version: resolvedVersion,
        engine,
        ...(emittedTargets ? { emittedTargets } : {}),
        updated: isUpdate,
        ...(publishResult ? { publish: publishResult } : {}),
      }, isUpdate ? 200 : 201, req);
    } catch (err) {
      // On failure, do NOT delete draftDir — preserve user's work
      sendJson(res, { error: `Failed to create skill: ${(err as Error).message}` }, 500, req);
    }
  });

  // POST /api/skills/save-draft — auto-save AI-generated skill as draft
  router.post("/api/skills/save-draft", async (req, res) => {
    const body = (await readBody(req)) as SaveDraftRequest;

    if (!body.name || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.name)) {
      sendJson(res, { error: "Name must be kebab-case" }, 400, req);
      return;
    }
    if (!body.description?.trim()) {
      sendJson(res, { error: "Description is required" }, 400, req);
      return;
    }
    if (!body.layout || ![1, 2, 3].includes(body.layout)) {
      sendJson(res, { error: "Layout must be 1, 2, or 3" }, 400, req);
      return;
    }

    const targetDir = computeSkillDir(root, body.layout, body.plugin || "", body.name);
    const skillMdPath = join(targetDir, "SKILL.md");
    const files: string[] = [];

    // 0728: Resolve version BEFORE writing. Three-tier precedence:
    //   1. Explicit body.version (caller wins).
    //   2. Existing on-disk version when re-saving an iteration draft —
    //      preserve so AI iteration doesn't downgrade work-in-progress.
    //   3. Default "1.0.0" for fresh drafts.
    let resolvedVersion: string;
    if (body.version?.trim()) {
      resolvedVersion = body.version.trim();
    } else if (existsSync(skillMdPath)) {
      resolvedVersion = extractFrontmatterVersion(readFileSync(skillMdPath, "utf-8")) ?? "1.0.0";
    } else {
      resolvedVersion = "1.0.0";
    }

    try {
      // Create directories (overwrites allowed for re-generation)
      mkdirSync(targetDir, { recursive: true });
      mkdirSync(join(targetDir, "evals"), { recursive: true });
      mkdirSync(join(targetDir, "evals", "history"), { recursive: true });

      // Write SKILL.md
      const content = buildSkillMd({ ...body, version: resolvedVersion });
      writeFileSync(skillMdPath, content, "utf-8");
      files.push("SKILL.md");

      // Write evals.json if provided
      if (body.evals && body.evals.length > 0) {
        const evalsData = { skill_name: body.name, evals: body.evals };
        writeFileSync(
          join(targetDir, "evals", "evals.json"),
          JSON.stringify(evalsData, null, 2) + "\n",
          "utf-8",
        );
        files.push("evals/evals.json");
      }

      // Write draft.json metadata
      const draftMeta = {
        draft: true,
        createdAt: new Date().toISOString(),
        aiPrompt: body.aiMeta.prompt,
        aiProvider: body.aiMeta.provider,
        aiModel: body.aiMeta.model,
        aiReasoning: body.aiMeta.reasoning,
      };
      writeFileSync(
        join(targetDir, "draft.json"),
        JSON.stringify(draftMeta, null, 2) + "\n",
        "utf-8",
      );
      files.push("draft.json");

      // Record AI generation history
      try {
        await writeHistoryEntry(targetDir, {
          timestamp: new Date().toISOString(),
          model: body.aiMeta.model,
          skill_name: body.name,
          cases: [],
          overall_pass_rate: undefined,
          type: "ai-generate",
          provider: body.aiMeta.provider,
          generate: { prompt: body.aiMeta.prompt, result: content },
        });
      } catch { /* history write failure should not break the main response */ }

      sendJson(res, {
        ok: true,
        plugin: body.layout === 3 ? (basename(root) || "default") : body.plugin,
        skill: body.name,
        dir: targetDir,
        skillMdPath,
        files,
      }, 201, req);
    } catch (err) {
      sendJson(res, { error: `Failed to save draft: ${(err as Error).message}` }, 500, req);
    }
  });

  // GET /api/skill-creator-status — check if skill-creator is installed
  router.get("/api/skill-creator-status", async (_req, res) => {
    const installed = isSkillCreatorInstalled(root);
    sendJson(res, {
      installed,
      installCommand: "npx vskill install anthropics/skills/skill-creator",
    }, 200, _req);
  });

  // POST /api/skills/generate — AI-assisted skill generation (parallel body + evals)
  // 0670 T-002: thin wrapper over src/core/skill-generator.ts:generateSkill.
  router.post("/api/skills/generate", async (req, res) => {
    const body = (await readBody(req)) as GenerateSkillRequest;
    if (!body.prompt || !body.prompt.trim())
      return sendJson(res, { error: "Describe what your skill should do" }, 400, req);
    if (body.prompt.length > 50000)
      return sendJson(res, { error: "Prompt is too long (max 50,000 characters)" }, 400, req);
    const resolved = await resolveProviderModel(body.provider, body.model);
    if (!resolved.ok) {
      const payload: Record<string, unknown> = { error: resolved.error };
      if (resolved.validProviders) payload.validProviders = resolved.validProviders;
      if (resolved.validModels) payload.validModels = resolved.validModels;
      return sendJson(res, payload, 400, req);
    }
    const wantsSSE = req.headers.accept?.includes("text/event-stream") ||
      (req.url ? new URL(req.url, "http://localhost").searchParams.has("sse") : false);
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    if (wantsSSE) initSSE(res, req);
    try {
      const parsed = await generateSkill(
        { ...body, provider: resolved.provider as ProviderName, model: resolved.model },
        {
          root,
          abortSignal: ac.signal,
          onProgress: wantsSSE ? (e) => { if (!ac.signal.aborted) sendSSE(res, "progress", e); } : undefined,
        },
      );
      if (ac.signal.aborted) return;
      const result = attachSuggestedPlugin(parsed, root);
      // 0711: emit provenance as a SEPARATE SSE event before `done` so the
      // GenerateSkillResult schema stays clean (parity tests assert on the
      // legacy shape). The UI's useCreateSkill listens for the `provenance`
      // event and stamps aiMeta. Best-effort — never blocks generation.
      if (wantsSSE && (resolved.provider === "anthropic" || resolved.provider === "claude-cli")) {
        try {
          const { resolveAnthropicModel } = await import("../eval/model-resolver.js");
          const r = resolveAnthropicModel(resolved.model);
          sendSSE(res, "provenance", {
            resolvedModelId: r.resolvedId || null,
            snapshotDate: r.snapshotDate,
            source: r.source,
          });
        } catch {
          /* provenance is best-effort; never block generation */
        }
      }
      if (wantsSSE) sendSSEDone(res, result); else sendJson(res, result, 200, req);
    } catch (err) {
      if (wantsSSE && !ac.signal.aborted) {
        sendSSE(res, "error", classifyError(err, resolved.provider));
        res.end();
      } else {
        const msg = (err as Error).message;
        sendJson(res, { error: msg }, msg.includes("not valid JSON") ? 422 : 500, req);
      }
    }
  });
}
