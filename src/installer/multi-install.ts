// 0845 T-011/T-016 — installSkillToMultipleAgents.
//
// Sequential per-agent dispatcher. Per-agent try/catch isolation so one
// agent's failure (transformer throw, path-traversal attempt, unknown id)
// does NOT abort the others (AC-US4-10).
//
// Dispatch matrix:
//   Tier 1 (installMode: "filesystem", no formatTransformer)
//     → installSymlink() / installCopy() via canonical.ts (zero behavior change)
//   Tier 2 (installMode: "filesystem", formatTransformer set)
//     → run transformer, write each TransformedFile under resolveAgentInstallRoot,
//       with path.relative() guard against traversal (AC-US4-11)
//     → op:"append-yaml-list" goes through safeAppendYamlList per ADR-0845-03
//   Tier 3 (installMode: "clipboard")
//     → buildClipboardBlob — no disk write (AC-US5-07)
//     → scope: "project" + Tier 3 → graceful downgrade, status "exported" with
//       warning in detail (T-016, AC-US5-06)
//
// FR-002: sequential. The slowest write is ~fs.writeFile (microseconds),
// so even 12 agents stays well under the 200ms-per-agent latency budget.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, relative, sep as pathSep, isAbsolute } from "node:path";
import os from "node:os";

import {
  AGENTS_REGISTRY,
  getAgent,
  type AgentDefinition,
} from "../agents/agents-registry.js";
import {
  installSymlink,
  installCopy,
  resolveAgentInstallRoot,
  type InstallOptions,
} from "./canonical.js";
import { extractDescription } from "./frontmatter.js";
import { buildClipboardBlob } from "./clipboard-export.js";
import { safeAppendYamlList } from "./yaml-safe-mutate.js";
import type { ParsedSkill, TransformedFile } from "./transformers/index.js";
import { sanitizeSkillBundleFiles } from "./bundle-files.js";

export type AgentInstallStatus = "installed" | "exported" | "skipped" | "error";

export interface AgentInstallResult {
  agentId: string;
  status: AgentInstallStatus;
  /** Installed: absolute path of the written file (or comma list when many).
   *  Exported:  human-readable label including any downgrade warning.
   *  Skipped:   reason.
   *  Error:     error message. */
  detail: string;
  /** Tier 3 only: the blob to be copied to clipboard. */
  blob?: string;
  /** Tier 3 only: paste-instructions URL. */
  pasteInstructionsUrl?: string;
  /** Tier 3 only: docs URL. */
  docsUrl?: string;
}

export interface MultiInstallResult {
  skill: string;
  scope: "project" | "user";
  agents: AgentInstallResult[];
  installedCount: number;
  exportedCount: number;
  errorCount: number;
}

export interface MultiInstallOptions {
  skill: ParsedSkill;
  agentIds: string[];
  scope: "project" | "user";
  /** Project root for project-scoped installs and for Tier-1 canonical writes. */
  projectRoot: string;
  /** Optional pre-rendered SKILL.md content. When omitted, the multi-install
   *  reconstructs it from the parsedSkill (frontmatter + body). */
  rawSkillContent?: string;
}

/**
 * Install a skill to multiple agents in a single pass. Returns one result
 * row per agent in the same order as `agentIds`. Never throws — each
 * agent's outcome is captured in its own result row.
 */
export async function installSkillToMultipleAgents(
  opts: MultiInstallOptions,
): Promise<MultiInstallResult> {
  const { skill, agentIds, scope, projectRoot } = opts;
  const results: AgentInstallResult[] = [];

  for (const agentId of agentIds) {
    const agent = getAgent(agentId);
    if (!agent) {
      results.push({
        agentId,
        status: "error",
        detail: `unknown agent: ${agentId}`,
      });
      continue;
    }
    results.push(installSkillForAgent(agent, skill, scope, projectRoot, opts.rawSkillContent));
  }

  const installedCount = results.filter((r) => r.status === "installed").length;
  const exportedCount = results.filter((r) => r.status === "exported").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return {
    skill: skill.name,
    scope,
    agents: results,
    installedCount,
    exportedCount,
    errorCount,
  };
}

/**
 * Dispatch a SINGLE agent through the tier matrix. This is the one shared
 * code path for both surfaces — Studio (installSkillToMultipleAgents) and the
 * CLI (installSkillToAgents) call it so Tier-2/Tier-3 behaviour can never drift
 * between the two. Never throws — every outcome (including unexpected escapes)
 * is captured in the returned result row.
 */
export function installSkillForAgent(
  agent: AgentDefinition,
  skill: ParsedSkill,
  scope: "project" | "user",
  projectRoot: string,
  rawSkillContent?: string,
): AgentInstallResult {
  try {
    if (agent.installMode === "clipboard") {
      return dispatchTier3(agent, skill, scope);
    }
    if (agent.formatTransformer) {
      return dispatchTier2(agent, skill, scope, projectRoot);
    }
    // Tier 1 — canonical drop-in install.
    return dispatchTier1(agent, skill, scope, projectRoot, rawSkillContent);
  } catch (err) {
    // Defensive catch-all — every dispatch path already wraps its own
    // errors, but if anything escapes, the caller's loop must keep going so
    // other agents still get processed.
    return {
      agentId: agent.id,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const NAME_RE = /^name:\s*(.+?)\s*$/m;
const VERSION_RE = /^version:\s*(.+?)\s*$/m;
const DESCRIPTION_RE = /^description:\s*(.+?)\s*$/m;

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Build a ParsedSkill from raw SKILL.md text. The CLI install path has only
 * the raw markdown string (fetched from GitHub or read from a plugin dir),
 * whereas Studio receives a pre-parsed ParsedSkill over the wire. This helper
 * gives the CLI the same shape so transformers see identical input regardless
 * of surface. Mirrors the server-side parser in install-skill-routes.ts.
 */
export function parseSkillForInstall(
  rawContent: string,
  fallbackName: string,
  bundleFiles?: Record<string, string>,
): ParsedSkill {
  const normalized = rawContent.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const fmMatch = normalized.match(FRONTMATTER_RE);
  let originalFrontmatter = "";
  let body = normalized;
  let nameFromFm: string | undefined;
  let version: string | undefined;
  let descriptionFromFm: string | undefined;
  if (fmMatch) {
    originalFrontmatter = fmMatch[1];
    body = fmMatch[2];
    const nameMatch = originalFrontmatter.match(NAME_RE);
    if (nameMatch) nameFromFm = unquoteYaml(nameMatch[1]);
    const versionMatch = originalFrontmatter.match(VERSION_RE);
    if (versionMatch) version = unquoteYaml(versionMatch[1]);
    const descMatch = originalFrontmatter.match(DESCRIPTION_RE);
    if (descMatch) descriptionFromFm = unquoteYaml(descMatch[1]);
  }
  const name = nameFromFm || fallbackName;
  const skill: ParsedSkill = {
    name,
    description: descriptionFromFm || extractDescription(body, name),
    body,
    originalFrontmatter,
  };
  if (version) skill.version = version;
  if (bundleFiles && Object.keys(bundleFiles).length > 0) skill.files = bundleFiles;
  return skill;
}

export interface InstallToAgentsOptions {
  /** Skill name (already namespaced if applicable) used for Tier-1 dir/symlink. */
  skillName: string;
  /** Raw SKILL.md content — Tier-1 keeps full frontmatter, Tier-2 reparses it. */
  rawContent: string;
  /** Selected agents (already filtered/namespaced by the caller). */
  agents: AgentDefinition[];
  scope: "project" | "user";
  projectRoot: string;
  /** When true, Tier-1 agents are copied instead of symlinked (CLI --copy). */
  copy?: boolean;
  /** Optional bundled resources (agents/*, scripts/*, …). */
  bundleFiles?: Record<string, string>;
}

/**
 * F9 — the CLI-facing install entry point. Dispatches the SAME per-agent
 * tier matrix as Studio, so a CLI install of a Tier-2 agent (cursor, windsurf,
 * aider, github-copilot-ext) now produces its real artifact instead of a
 * dead-letter `<agent>/skills/<name>/SKILL.md`.
 *
 * Tier-1 agents are installed as a single batch through installSymlink /
 * installCopy — preserving the canonical `.agents/skills` store with relative
 * symlinks, the claude-code COPY_FALLBACK with full frontmatter, and the
 * `--copy` option. Tier-2/Tier-3 agents are dispatched one-by-one through the
 * shared `installSkillForAgent`.
 *
 * Returns the flat list of written paths (Tier-1 + Tier-2) for the CLI summary;
 * Tier-3 (clipboard) agents contribute no path.
 */
export function installSkillToAgents(opts: InstallToAgentsOptions): string[] {
  const { skillName, rawContent, agents, scope, projectRoot, copy } = opts;
  const installOpts: InstallOptions = { global: scope === "user", projectRoot };
  const bundleFiles = opts.bundleFiles
    ? sanitizeSkillBundleFiles(opts.bundleFiles)
    : undefined;

  // Tier-1 = filesystem drop-in agents with no per-tool transformer. They keep
  // the existing batch install (canonical store + symlink dedup + COPY_FALLBACK).
  const tier1 = agents.filter(
    (a) => a.installMode !== "clipboard" && !a.formatTransformer,
  );
  const tier2or3 = agents.filter(
    (a) => a.installMode === "clipboard" || !!a.formatTransformer,
  );

  const written: string[] = [];

  if (tier1.length > 0) {
    const fn = copy ? installCopy : installSymlink;
    written.push(...fn(skillName, rawContent, tier1, installOpts, bundleFiles));
  }

  if (tier2or3.length > 0) {
    const skill = parseSkillForInstall(rawContent, skillName, bundleFiles);
    for (const agent of tier2or3) {
      const result = installSkillForAgent(agent, skill, scope, projectRoot, rawContent);
      if (result.status === "installed" && result.detail) {
        // dispatchTier2 returns a comma-joined path list (may annotate
        // append-yaml-list entries with a "(status)" suffix); split it back
        // out so the CLI summary lists one path per line.
        for (const part of result.detail.split(", ")) {
          if (part) written.push(part);
        }
      } else if (result.status === "error") {
        throw new Error(`${agent.id}: ${result.detail}`);
      }
      // Tier-3 (exported) contributes no on-disk path.
    }
  }

  return written;
}

// ---------------------------------------------------------------------------
// Tier 1 — canonical drop-in via installSymlink
// ---------------------------------------------------------------------------

function dispatchTier1(
  agent: AgentDefinition,
  skill: ParsedSkill,
  scope: "project" | "user",
  projectRoot: string,
  rawContent?: string,
): AgentInstallResult {
  const installOpts: InstallOptions = {
    global: scope === "user",
    projectRoot,
  };
  const content = rawContent ?? reconstructSkillMd(skill);
  const bundleFiles = sanitizeSkillBundleFiles(skill.files);
  const writtenPaths = installSymlink(skill.name, content, [agent], installOpts, bundleFiles);
  return {
    agentId: agent.id,
    status: "installed",
    detail: writtenPaths.join(", "),
  };
}

// ---------------------------------------------------------------------------
// Tier 2 — transformer + filesystem write
// ---------------------------------------------------------------------------

function dispatchTier2(
  agent: AgentDefinition,
  skill: ParsedSkill,
  scope: "project" | "user",
  projectRoot: string,
): AgentInstallResult {
  if (!agent.formatTransformer) {
    return {
      agentId: agent.id,
      status: "error",
      detail: "internal: tier 2 dispatch without formatTransformer",
    };
  }

  const installOpts: InstallOptions = {
    global: scope === "user",
    projectRoot,
  };
  const installRoot = resolveAgentInstallRoot(agent, installOpts);

  let files: TransformedFile[];
  try {
    files = [
      ...agent.formatTransformer(skill, scope),
      ...buildTier2BundleFiles(skill),
    ];
  } catch (err) {
    return {
      agentId: agent.id,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const writtenPaths: string[] = [];
  try {
    for (const file of files) {
      // Join with POSIX-style separator awareness — transformers always
      // emit forward slashes, Node's path.join handles win32.
      const joined = join(installRoot, ...file.relativePath.split("/"));

      // op:"append-yaml-list" is the only sanctioned escape from the
      // install root — Aider's ~/.aider.conf.yml lives at $HOME, not
      // inside ~/.aider. Still bound by HOME (or projectRoot for project
      // scope) so the dispatcher cannot be tricked into writing outside
      // the user's filesystem boundary.
      if (file.op === "append-yaml-list") {
        const boundary = scope === "user" ? os.homedir() : projectRoot;
        assertNoTraversal(boundary, joined);
        const key = file.yamlListKey ?? "";
        // Keep the value verbatim — Aider expects the literal `~/path` in
        // its conf.yml so the file is portable across machines. The tilde
        // resolution happens inside Aider itself at load time.
        const value = file.yamlListValue ?? "";
        if (!key || !value) {
          return {
            agentId: agent.id,
            status: "error",
            detail: "internal: append-yaml-list missing key or value",
          };
        }
        mkdirSync(dirname(joined), { recursive: true });
        const r = safeAppendYamlList(joined, key, value);
        writtenPaths.push(`${joined} (${r.status})`);
      } else {
        assertNoTraversal(installRoot, joined);
        mkdirSync(dirname(joined), { recursive: true });
        writeFileSync(joined, file.content, { mode: file.mode });
        writtenPaths.push(joined);
      }
    }
  } catch (err) {
    return {
      agentId: agent.id,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    agentId: agent.id,
    status: "installed",
    detail: writtenPaths.join(", "),
  };
}

// ---------------------------------------------------------------------------
// Tier 3 — clipboard export (no disk write)
// ---------------------------------------------------------------------------

function dispatchTier3(
  agent: AgentDefinition,
  skill: ParsedSkill,
  scope: "project" | "user",
): AgentInstallResult {
  const blob = buildClipboardBlob(skill, agent.id);
  const detailParts: string[] = ["clipboard blob ready"];
  if (scope === "project") {
    detailParts.push(
      `${agent.displayName} does not support project-scoped skills; exported as user-scope blob.`,
    );
  }
  const result: AgentInstallResult = {
    agentId: agent.id,
    status: "exported",
    detail: detailParts.join(" — "),
    blob: blob.blob,
    pasteInstructionsUrl: blob.pasteInstructionsUrl,
  };
  if (blob.docsUrl) result.docsUrl = blob.docsUrl;
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertNoTraversal(root: string, target: string): void {
  // Both paths are absolute (or both relative). path.relative returns
  // a path that starts with ".." iff target escapes root. Matches the
  // pre-existing guard at canonical.ts:54-58.
  if (!isAbsolute(target)) {
    throw new Error(`internal: install target must be absolute (got ${target})`);
  }
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(".." + pathSep) || rel.startsWith("../")) {
    throw new Error(
      `Path traversal detected: ${target} escapes install root ${root}`,
    );
  }
}

function reconstructSkillMd(skill: ParsedSkill): string {
  // installSymlink expects the raw SKILL.md text — frontmatter + body.
  // The parsedSkill carries `originalFrontmatter`; if absent, fabricate
  // a minimal name+description block so installSymlink's
  // `ensureFrontmatter` has something to work with.
  const fm = skill.originalFrontmatter.trim().length > 0
    ? skill.originalFrontmatter
    : `name: ${skill.name}\ndescription: ${skill.description}`;
  return `---\n${fm}\n---\n\n${skill.body}`;
}

function buildTier2BundleFiles(skill: ParsedSkill): TransformedFile[] {
  const bundleFiles = sanitizeSkillBundleFiles(skill.files);
  return Object.entries(bundleFiles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relativePath, content]) => ({
      relativePath: `skills/${skill.name}/${relativePath}`,
      content,
    }));
}

// Re-export for ergonomic test access. Not strictly needed but lets
// integration tests import the same registry the dispatcher sees.
export { AGENTS_REGISTRY };
