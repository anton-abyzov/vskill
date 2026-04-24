// ---------------------------------------------------------------------------
// skill-emitter.ts — pure skill-to-file emitter (T-009 + T-010 of 0670).
//
// Takes a GenerateSkillResult and emits one file per target agent plus a
// divergence report documenting what was dropped or translated on the way
// down from canonical (Claude-style) frontmatter to each target's native
// schema.
//
// Contract (pinned — Chain C depends on this):
//   • No fs / network / timestamp side effects — pure function.
//   • Every universal emission carries `x-sw-schema-version: 1` (T-010).
//   • Anthropic fallback (engine='anthropic-skill-creator') emits exactly one
//     claude-code file, no schema version, exact sentinel divergence report.
//   • Security-critical fields (allowed-tools, context.fork, model) MUST be
//     recorded on any drop or translation — silent loss is a bug
//     (AC-US5-03 / FR-004).
//   • Divergence report sentinel when nothing diverged:
//       "No divergences — all targets universal"
//   • Legacy agent ids (e.g. `github-copilot`) resolve through
//     LEGACY_AGENT_IDS and the emitted targetId is always canonical.
// ---------------------------------------------------------------------------

import {
  AGENTS_REGISTRY,
  LEGACY_AGENT_IDS,
  type AgentDefinition,
} from "../agents/agents-registry.js";
import { ensureFrontmatter } from "../installer/frontmatter.js";
import type { GenerateSkillResult } from "./skill-generator.js";

export type EngineMode = "universal" | "anthropic-skill-creator";

export interface EmitOptions {
  /** Agent IDs to emit for. Legacy aliases resolve via LEGACY_AGENT_IDS. */
  targetAgents: string[];
  /** 'universal' emits cross-tool; 'anthropic-skill-creator' is Claude-only. */
  engine: EngineMode;
  /** Injected clock — tests pass a frozen Date for deterministic output. */
  now?: Date;
}

export interface EmittedFileDescriptor {
  /** Canonical agent id from AGENTS_REGISTRY. */
  targetId: string;
  /** Path from cwd, e.g. ".claude/skills/<slug>/SKILL.md". */
  relativePath: string;
  /** Full file content including frontmatter. */
  content: string;
}

export interface DivergenceEntry {
  targetId: string;
  field: string;
  originalValue: unknown;
  /** Human-readable translation description; null when the field was dropped. */
  translation: string | null;
  kind: "dropped" | "translated" | "security-critical-dropped";
}

export interface EmitResult {
  files: EmittedFileDescriptor[];
  divergences: DivergenceEntry[];
  skipped: Array<{ targetId: string; reason: string }>;
  /** Markdown report destined for `<slug>-divergence.md`. */
  divergenceReport: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Exact sentinel when no divergences across any emission (AC-US5-05). */
const NO_DIVERGENCES_SENTINEL = "No divergences — all targets universal";

/** Exact sentinel for the anthropic fallback engine (AC-US2-03). */
const ANTHROPIC_FALLBACK_SENTINEL =
  "[skill-builder] fallback mode — universal targets not emitted; install vskill for universal support";

/** Security-critical frontmatter fields — surface on any drop/translation. */
const SECURITY_CRITICAL_FIELDS: ReadonlySet<string> = new Set([
  "allowed-tools",
  "context.fork",
  "model",
]);

/** Skip reason for non-claude targets under anthropic engine (AC-US2-03). */
const ANTHROPIC_SKIP_REASON =
  "anthropic-skill-creator engine only supports claude-code";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve legacy aliases to the canonical AgentDefinition. */
function resolveAgent(id: string): AgentDefinition | undefined {
  const canonical = LEGACY_AGENT_IDS[id] ?? id;
  return AGENTS_REGISTRY.find((a) => a.id === canonical);
}

/** Split `allowedTools` string ("Bash, Read") into normalized tokens. */
function parseAllowedTools(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Strip any existing frontmatter block and return the body. The emitter
 * rebuilds a canonical per-target frontmatter rather than patching whatever
 * the LLM returned — that way the schema-version tag and target-specific
 * translations are deterministic regardless of source.
 */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? content.slice(match[0].length) : content;
}

/**
 * Format a frontmatter block from an ordered key/value list. Values are
 * emitted verbatim — callers are responsible for quoting. Multi-line block
 * values use the `|` style and get indented by 2 spaces. This intentionally
 * does NOT use the `yaml` package (not a dep in this repo).
 */
function formatFrontmatter(entries: Array<[string, string]>): string {
  const lines = ["---"];
  for (const [key, value] of entries) {
    if (value.includes("\n")) {
      lines.push(`${key}: |`);
      for (const l of value.split("\n")) lines.push(`  ${l}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * YAML-safe value emission for simple scalar-ish inputs. Quotes whenever
 * the value contains characters that YAML would interpret (`:`, `#`, etc).
 */
function yamlScalar(value: string): string {
  if (value === "") return '""';
  if (/[:#\[\]{}'*&!>|"\\,]/.test(value) || /^\s|\s$/.test(value)) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Per-target translation
//
// Each translator takes the canonical (Claude-style) result + agent, and
// returns either a set of frontmatter entries + divergence records, or a
// skip-with-reason signal.
// ---------------------------------------------------------------------------

interface PerTargetEmission {
  kind: "file";
  entries: Array<[string, string]>;
  divergences: DivergenceEntry[];
}

interface PerTargetSkip {
  kind: "skip";
  reason: string;
  divergences: DivergenceEntry[];
}

type PerTargetResult = PerTargetEmission | PerTargetSkip;

/**
 * Record a divergence for a security-critical field when the target cannot
 * express it. Callers decide kind (dropped / security-critical-dropped /
 * translated) — this helper just accumulates.
 */
function pushDivergence(
  acc: DivergenceEntry[],
  targetId: string,
  field: string,
  originalValue: unknown,
  translation: string | null,
  kind: DivergenceEntry["kind"],
): void {
  acc.push({ targetId, field, originalValue, translation, kind });
}

/**
 * Build frontmatter for a universal target.
 *
 * Universal agents (the 8 listed in AGENTS_REGISTRY) share the same
 * SKILL.md schema as Claude, so canonical fields flow through with minimal
 * translation. OpenCode is the one exception: it translates
 * `allowed-tools` into a `permission:` block.
 */
function emitForUniversal(
  generated: GenerateSkillResult,
  agent: AgentDefinition,
): PerTargetEmission {
  const entries: Array<[string, string]> = [
    ["name", yamlScalar(generated.name)],
    ["description", yamlScalar(generated.description)],
  ];
  const divergences: DivergenceEntry[] = [];

  const tools = parseAllowedTools(generated.allowedTools);

  if (agent.id === "opencode") {
    // OpenCode translates allowed-tools into a permission map.
    if (tools.length > 0) {
      const permLines = tools
        .map((t) => `  ${t.toLowerCase()}: ask`)
        .join("\n");
      const permBlock = `\n${permLines}`;
      entries.push(["permission", permBlock]);
      const translationSummary = `permission: { ${tools
        .map((t) => `${t.toLowerCase()}: ask`)
        .join(", ")} }`;
      pushDivergence(
        divergences,
        agent.id,
        "allowed-tools",
        generated.allowedTools,
        translationSummary,
        "translated",
      );
    }
  } else if (tools.length > 0) {
    // Other universal agents: drop allowed-tools (most don't enforce tool
    // allowlists). Security-critical — always record.
    pushDivergence(
      divergences,
      agent.id,
      "allowed-tools",
      generated.allowedTools,
      null,
      "security-critical-dropped",
    );
  }

  // `model` field: universal agents (other than claude-code) bind model at
  // the host level. Record as security-critical when present.
  if (generated.model && generated.model.trim() !== "") {
    pushDivergence(
      divergences,
      agent.id,
      "model",
      generated.model,
      null,
      "security-critical-dropped",
    );
  }

  // Schema version tag — T-010 / AC-US6-01.
  entries.push(["x-sw-schema-version", "1"]);

  return { kind: "file", entries, divergences };
}

/**
 * Build frontmatter for a non-universal, non-claude target.
 *
 * MVP rule: if the agent cannot meaningfully express frontmatter
 * (`customSystemPrompt: false`) we skip it with a reason rather than emit
 * a lossy file. Security-critical divergences are still recorded so the
 * caller can surface them in the report.
 */
function emitForNonUniversal(
  generated: GenerateSkillResult,
  agent: AgentDefinition,
): PerTargetResult {
  const divergences: DivergenceEntry[] = [];

  // Always record security-critical drops before deciding skip/emit — these
  // must surface in the report regardless of whether a file is emitted.
  if (parseAllowedTools(generated.allowedTools).length > 0) {
    pushDivergence(
      divergences,
      agent.id,
      "allowed-tools",
      generated.allowedTools,
      null,
      "security-critical-dropped",
    );
  }
  if (generated.model && generated.model.trim() !== "") {
    pushDivergence(
      divergences,
      agent.id,
      "model",
      generated.model,
      null,
      "security-critical-dropped",
    );
  }

  if (!agent.featureSupport.customSystemPrompt) {
    return {
      kind: "skip",
      reason: `${agent.id} cannot express skill frontmatter (customSystemPrompt=false)`,
      divergences,
    };
  }

  const entries: Array<[string, string]> = [
    ["name", yamlScalar(generated.name)],
    ["description", yamlScalar(generated.description)],
    ["x-sw-schema-version", "1"],
  ];
  return { kind: "file", entries, divergences };
}

/**
 * Build frontmatter for the claude-code target. Claude Code supports the
 * full canonical frontmatter (allowed-tools, model, context) — nothing is
 * dropped or translated.
 */
function emitForClaude(
  generated: GenerateSkillResult,
  _agent: AgentDefinition,
  engine: EngineMode,
): PerTargetEmission {
  const entries: Array<[string, string]> = [
    ["name", yamlScalar(generated.name)],
    ["description", yamlScalar(generated.description)],
  ];
  if (generated.allowedTools && generated.allowedTools.trim() !== "") {
    entries.push(["allowed-tools", yamlScalar(generated.allowedTools)]);
  }
  if (generated.model && generated.model.trim() !== "") {
    entries.push(["model", yamlScalar(generated.model)]);
  }

  // Anthropic fallback engine DOES NOT add the schema version (AC-US6-03).
  if (engine === "universal") {
    entries.push(["x-sw-schema-version", "1"]);
  }
  return { kind: "file", entries, divergences: [] };
}

/**
 * Dispatch a single target to the appropriate emitter.
 */
function emitForAgent(
  generated: GenerateSkillResult,
  agent: AgentDefinition,
  engine: EngineMode,
): PerTargetResult {
  if (agent.id === "claude-code") return emitForClaude(generated, agent, engine);
  if (agent.isUniversal) return emitForUniversal(generated, agent);
  return emitForNonUniversal(generated, agent);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

/**
 * Render the markdown divergence report. The shape follows
 * plugins/skills/skills/skill-builder/references/divergence-report-schema.md:
 *
 *   # <skill-name> — divergence report
 *
 *   ## <targetId>
 *   - Dropped: <field> (reason)
 *   - Translated: <field> → <translation>
 *   ...
 *
 * Targets are sorted by AGENTS_REGISTRY order for stability.
 */
function renderDivergenceReport(
  generated: GenerateSkillResult,
  perTarget: Array<{
    targetId: string;
    emitted: boolean;
    divergences: DivergenceEntry[];
    skippedReason?: string;
  }>,
): string {
  const anyDivergences = perTarget.some((t) => t.divergences.length > 0);
  if (!anyDivergences && perTarget.every((t) => t.emitted)) {
    return NO_DIVERGENCES_SENTINEL;
  }

  const lines: string[] = [`# ${generated.name} — divergence report`, ""];
  for (const t of perTarget) {
    lines.push(`## ${t.targetId}`);
    if (t.skippedReason) {
      lines.push(`- Skipped: ${t.skippedReason}`);
    }
    if (t.divergences.length === 0 && !t.skippedReason) {
      lines.push("- No changes. All frontmatter preserved.");
    } else {
      for (const d of t.divergences) {
        if (d.kind === "translated" && d.translation) {
          lines.push(`- Translated: ${d.field} → ${d.translation}`);
        } else if (d.kind === "security-critical-dropped") {
          lines.push(
            `- Dropped (security-critical): ${d.field} (target cannot express this field)`,
          );
        } else {
          lines.push(`- Dropped: ${d.field}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function emitSkill(
  generated: GenerateSkillResult,
  options: EmitOptions,
): EmitResult {
  // --- anthropic-skill-creator fallback short-circuit ---
  if (options.engine === "anthropic-skill-creator") {
    const files: EmittedFileDescriptor[] = [];
    const skipped: Array<{ targetId: string; reason: string }> = [];

    for (const raw of options.targetAgents) {
      const agent = resolveAgent(raw);
      // Retain the CALLER's id form in skip output so the caller can
      // match it back to their input list; file emission uses canonical.
      if (!agent) {
        skipped.push({ targetId: raw, reason: `unknown agent id: ${raw}` });
        continue;
      }
      if (agent.id !== "claude-code") {
        skipped.push({ targetId: agent.id, reason: ANTHROPIC_SKIP_REASON });
        continue;
      }
      const emission = emitForClaude(generated, agent, "anthropic-skill-creator");
      const body = stripFrontmatter(generated.body);
      const content = `${formatFrontmatter(emission.entries)}\n\n${body}`;
      files.push({
        targetId: "claude-code",
        relativePath: `${agent.localSkillsDir}/${generated.name}/SKILL.md`,
        content: ensureFrontmatter(content, generated.name),
      });
    }

    return {
      files,
      divergences: [],
      skipped,
      divergenceReport: ANTHROPIC_FALLBACK_SENTINEL,
    };
  }

  // --- universal engine path ---
  const files: EmittedFileDescriptor[] = [];
  const divergences: DivergenceEntry[] = [];
  const skipped: Array<{ targetId: string; reason: string }> = [];
  const perTarget: Array<{
    targetId: string;
    emitted: boolean;
    divergences: DivergenceEntry[];
    skippedReason?: string;
  }> = [];

  // Stable iteration order: process targetAgents in caller-supplied order.
  // (Tests and downstream tooling don't depend on a specific order.)
  for (const raw of options.targetAgents) {
    const agent = resolveAgent(raw);
    if (!agent) {
      skipped.push({ targetId: raw, reason: `unknown agent id: ${raw}` });
      continue;
    }

    const result = emitForAgent(generated, agent, "universal");
    if (result.kind === "skip") {
      skipped.push({ targetId: agent.id, reason: result.reason });
      divergences.push(...result.divergences);
      perTarget.push({
        targetId: agent.id,
        emitted: false,
        divergences: result.divergences,
        skippedReason: result.reason,
      });
      continue;
    }

    const body = stripFrontmatter(generated.body);
    const content = `${formatFrontmatter(result.entries)}\n\n${body}`;
    files.push({
      targetId: agent.id,
      relativePath: `${agent.localSkillsDir}/${generated.name}/SKILL.md`,
      content,
    });
    divergences.push(...result.divergences);
    perTarget.push({
      targetId: agent.id,
      emitted: true,
      divergences: result.divergences,
    });
  }

  const divergenceReport = renderDivergenceReport(generated, perTarget);

  return { files, divergences, skipped, divergenceReport };
}
