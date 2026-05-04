// ---------------------------------------------------------------------------
// vskill clone — shared type contracts
// ---------------------------------------------------------------------------
// Source of truth for the `vskill clone` command. Consumed by skill-locator,
// frontmatter rewriter, provenance-fork, target-router, github-scaffold, and
// the orchestrator in src/commands/clone.ts.
//
// See .specweave/increments/0822-vskill-clone-skill-fork/spec.md and plan.md.
// ---------------------------------------------------------------------------

import type { Provenance } from "../studio/types.js";

/** Where a skill lives on disk. */
export type SkillSourceLocation = "project" | "personal" | "cache";

/** A discovered source skill, with absolute path and parsed identity. */
export interface SkillSource {
  location: SkillSourceLocation;
  /** Absolute path to the skill directory (the dir containing SKILL.md). */
  skillDir: string;
  /** Skill name as parsed from frontmatter (or directory basename if frontmatter lacks `name`). */
  skillName: string;
  /** Original namespace if discoverable (e.g., "sw" for plugin-cache sources). undefined for personal/project. */
  namespace?: string;
  /** Original version from frontmatter (or "0.0.0" if absent). */
  version: string;
  /** Plugin context — present only for cache-located skills. */
  plugin?: {
    pluginNamespace: string;
    pluginName: string;
    pluginVersion: string;
    pluginRoot: string;
  };
  /** Existing provenance read from .vskill-meta.json (null if no sidecar). */
  existingProvenance: Provenance | null;
}

/** Where the cloned skill should be written. */
export type CloneTargetKind = "standalone" | "plugin" | "new-plugin";

export interface CloneTarget {
  kind: CloneTargetKind;
  /** Absolute path to the final skill directory (where files end up after atomic rename). */
  targetSkillDir: string;
  /** For "plugin" kind: absolute path to the existing plugin's .claude-plugin/plugin.json. */
  existingPluginManifestPath?: string;
  /** For "new-plugin" kind: absolute path to the plugin root being scaffolded. */
  newPluginRoot?: string;
  /** For "new-plugin" kind: name to use in the new plugin manifest. */
  newPluginName?: string;
}

export interface CloneOptions {
  /** New namespace for the cloned skill (e.g., "anton"). Required. */
  namespace: string;
  /** New author name. Required. */
  author: string;
  /** When true, overwrite existing target without confirmation. */
  force: boolean;
  /** When true, after files land, scaffold a GitHub repo via gh. */
  github: boolean;
  /** When true, do not write any files — just print the planned actions. */
  dryRun: boolean;
}

/** Result returned by the clone orchestrator. */
export interface CloneResult {
  source: SkillSource;
  target: CloneTarget;
  /** Final skill name written (e.g., "anton/ado-mapper"). */
  finalSkillName: string;
  /** Number of files copied. */
  filesCopied: number;
  /** Cross-skill references found in the body (informational, not auto-rewritten). */
  referenceReport: ReferenceMatch[];
  /** Self-name occurrences in prose (informational). */
  selfNameMatches: ReferenceMatch[];
  /** GitHub repo URL if --github was used and succeeded; null if skipped. */
  githubRepoUrl: string | null;
  /** Provenance written to the cloned skill. */
  provenance: Provenance;
}

export interface ReferenceMatch {
  /** Path of the file the match was found in (relative to skill root). */
  file: string;
  /** Line number (1-indexed). */
  line: number;
  /** The matched text (e.g., "sw:ado-mapper"). */
  match: string;
  /** Pattern category. */
  kind: "backtick" | "skill-call" | "slash-command" | "self-name";
}

/** Fork provenance metadata written to the cloned skill's .vskill-meta.json. */
export interface ForkProvenance {
  source: string;
  version: string;
  clonedAt: string;
}
