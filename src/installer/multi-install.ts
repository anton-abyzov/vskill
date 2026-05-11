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
  resolveAgentInstallRoot,
  type InstallOptions,
} from "./canonical.js";
import { buildClipboardBlob } from "./clipboard-export.js";
import { safeAppendYamlList } from "./yaml-safe-mutate.js";
import type { ParsedSkill, TransformedFile } from "./transformers/index.js";

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
    try {
      const agent = getAgent(agentId);
      if (!agent) {
        results.push({
          agentId,
          status: "error",
          detail: `unknown agent: ${agentId}`,
        });
        continue;
      }

      if (agent.installMode === "clipboard") {
        results.push(dispatchTier3(agent, skill, scope));
        continue;
      }

      if (agent.formatTransformer) {
        results.push(dispatchTier2(agent, skill, scope, projectRoot));
        continue;
      }

      // Tier 1 — canonical drop-in install.
      results.push(dispatchTier1(agent, skill, scope, projectRoot, opts.rawSkillContent));
    } catch (err) {
      // Defensive catch-all — every dispatch path already wraps its own
      // errors, but if anything escapes, the multi-install loop must keep
      // going so other agents still get processed.
      results.push({
        agentId,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
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
  const writtenPaths = installSymlink(skill.name, content, [agent], installOpts);
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
    files = agent.formatTransformer(skill);
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

// Re-export for ergonomic test access. Not strictly needed but lets
// integration tests import the same registry the dispatcher sees.
export { AGENTS_REGISTRY };
