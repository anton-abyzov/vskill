// 0845 T-001 — Shared types for per-tool format transformers.
//
// These interfaces are imported by Phase-2 transformer modules
// (cursor.ts, windsurf.ts, github-copilot.ts, etc.) and by the
// `AgentDefinition.formatTransformer` field in agents-registry.ts.
//
// Types live in this barrel so Phase-2 work can land transformer
// files without touching the registry (no circular dep) and so
// the registry itself only needs to import a stable type module.
//
// ADR cross-ref: 0845-02-per-tool-format-transformer.md.

/**
 * Parsed SKILL.md ready for transformation. Produced by the installer
 * (`parseFrontmatter` + body extraction) and consumed by per-tool
 * transformer functions. The shape intentionally exposes the raw
 * frontmatter block so transformers that preserve fields (e.g.
 * `version`, `author`) can re-emit them without re-parsing.
 */
export interface ParsedSkill {
  /** Skill name without publisher prefix (e.g. "obsidian-brain"). */
  name: string;
  /**
   * First non-empty body line, truncated to 200 chars. Transformers that
   * emit frontmatter (Cursor, GitHub Copilot, etc.) put this in their
   * `description` field.
   */
  description: string;
  /**
   * Body after the closing `---` of the SKILL.md frontmatter,
   * CRLF-normalized to LF. Verbatim — transformers MUST preserve.
   */
  body: string;
  /**
   * Raw YAML frontmatter block (between the `---` fences), so
   * transformers can preserve fields like `version` or `author` when
   * needed. Empty string when the source had no frontmatter.
   */
  originalFrontmatter: string;
  /** Convenience: parsed-out `version` field if present. */
  version?: string;
  /**
   * Optional bundled skill resources keyed by path relative to the skill root.
   * Standard paths are `agents/`, `scripts/`, `references/`, `assets/`,
   * `tests/`, and `.env.example`; callers validate path safety before write.
   */
  files?: Record<string, string>;
}

/**
 * A single file emitted by a transformer. The dispatcher in
 * `multi-install.ts` joins `relativePath` onto the agent's install
 * root and writes `content` via `fs.writeFile`.
 *
 * `op === "append-yaml-list"` is the Aider escape hatch — instead of
 * a plain write, the dispatcher invokes the safe YAML mutation
 * routine (ADR-0845-03) to append `yamlListValue` to `yamlListKey`.
 */
export interface TransformedFile {
  /**
   * Path relative to the agent's install root (the parent of
   * `localSkillsDir` / `globalSkillsDir`). E.g. `"rules/obsidian-brain.mdc"`
   * for Cursor → resolves to `~/.cursor/rules/obsidian-brain.mdc`.
   *
   * POSIX forward-slash separators required; joined with `path.join()`
   * at write time so Win32 backslashes are handled by Node.
   */
  relativePath: string;
  /** Final file contents, byte-equal across re-runs (idempotent). */
  content: string;
  /** Optional file mode (defaults to 0o644). */
  mode?: number;
  /**
   * Default `"write"`. When `"append-yaml-list"`, the dispatcher
   * invokes `safeAppendYamlList()` instead of `fs.writeFile`. Used
   * by the Aider transformer for the `~/.aider.conf.yml` entry.
   */
  op?: "write" | "append-yaml-list";
  /** When `op === "append-yaml-list"`: the YAML key to mutate. */
  yamlListKey?: string;
  /** When `op === "append-yaml-list"`: the value to append to the list. */
  yamlListValue?: string;
}

/** Install scope, threaded from MultiInstallOptions to transformers. */
export type InstallScope = "project" | "user";

/**
 * Per-tool format transformer. Pure function — no I/O. Given a
 * `ParsedSkill`, returns the list of files to write under the
 * agent's install root. Re-running with the same input MUST
 * produce byte-equal output (idempotency contract enforced by
 * each transformer's unit tests).
 *
 * `scope` is optional (defaults to user) — most transformers emit
 * scope-independent paths; Aider needs it because its conf.yml `read:`
 * entry must reference the conventions file where it actually landed.
 */
export type FormatTransformer = (
  skill: ParsedSkill,
  scope?: InstallScope,
) => TransformedFile[];
