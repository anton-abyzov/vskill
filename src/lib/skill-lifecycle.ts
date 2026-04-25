// ---------------------------------------------------------------------------
// Skill lifecycle helpers (0724 T-001)
//
// Pure functions used by the install / enable / disable surface to:
//   - resolve a `<skillName>@<marketplace>` plugin id from a lockfile entry
//   - classify each agent surface into "claude-code-style" (uses
//     enabledPlugins in settings.json) or "auto-discover" (just reads its
//     skills dir on the filesystem)
//   - build a per-agent report ({id, displayName, surface, line, action})
//     that drives both human-readable and JSON output on enable/disable/
//     install/remove.
//
// All functions are pure — no I/O, no subprocess, no fs. Heavy lifting (the
// actual `claude plugin install/uninstall` invocation, lockfile read/write,
// settings.json read) is the caller's responsibility.
// ---------------------------------------------------------------------------

import type { SkillLockEntry } from "../lockfile/types.js";
import type { AgentDefinition } from "../agents/agents-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How an agent surface receives a skill enablement.
 *
 * - "claude-code-style": the agent reads `enabledPlugins` from a
 *   settings.json file (today, only Claude Code), so toggling requires a
 *   `claude plugin install/uninstall` invocation.
 * - "auto-discover": the agent picks up skills by scanning its
 *   `localSkillsDir` / `globalSkillsDir`, so there is nothing to toggle —
 *   `vskill remove <name>` is the only way to un-load such a skill.
 */
export type AgentSurfaceClass = "claude-code-style" | "auto-discover";

/**
 * The lifecycle action that produced the report row.
 *
 * Drives the wording in the human-readable line. Machine consumers should
 * read the structured `action` field rather than parsing the string.
 */
export type LifecycleAction =
  | "enabled"
  | "already-enabled"
  | "disabled"
  | "already-disabled"
  | "not-applicable";

export interface PerAgentReportEntry {
  /** Agent id (e.g. "claude-code") */
  id: string;
  /** Display name (e.g. "Claude Code") */
  displayName: string;
  /** Whether this agent uses enabledPlugins or auto-discovers from disk */
  surface: AgentSurfaceClass;
  /** The lifecycle action that resolved for this agent */
  action: LifecycleAction;
  /** Pre-formatted human-readable line, e.g. "Claude Code (user) — enabled via claude CLI" */
  line: string;
}

export interface BuildPerAgentReportOptions {
  /** Skill name (used for log context, not currently embedded in the line). */
  skill: string;
  /** Target scope of the operation. */
  scope: "user" | "project";
  /** The action that triggered the report. Auto-discover agents always map to `not-applicable` for enable/disable actions. */
  action: LifecycleAction;
  /** The list of agents detected on the local machine. */
  agents: AgentDefinition[];
}

// ---------------------------------------------------------------------------
// resolvePluginId
// ---------------------------------------------------------------------------

/**
 * Compute the plugin id used by the claude CLI.
 *
 * Format: `<skillName>@<marketplace>`. Returns `null` when the lockfile
 * entry has no `marketplace` field (or it is empty), which signals that the
 * skill is auto-discovered and there is no plugin entry to enable / disable.
 *
 * Parameter type is narrowed to `Pick<SkillLockEntry, 'marketplace'>` so
 * callers that only have a partial entry shape (e.g. enableAfterInstall in
 * add.ts) don't need to cast — the function only ever reads `marketplace`.
 */
export function resolvePluginId(
  skillName: string,
  entry: Pick<SkillLockEntry, "marketplace">,
): string | null {
  if (!entry.marketplace || entry.marketplace.length === 0) {
    return null;
  }
  return `${skillName}@${entry.marketplace}`;
}

// ---------------------------------------------------------------------------
// classifyAgentSurface
// ---------------------------------------------------------------------------

/**
 * Decide whether an agent uses settings.json's enabledPlugins (claude-code
 * style) or auto-discovers skills from its skills dir.
 *
 * Today the only `claude-code-style` agent is `claude-code` itself. Every
 * other agent in the registry auto-discovers from its `localSkillsDir` /
 * `globalSkillsDir`, so toggling a skill there is a no-op (the only way to
 * un-load it is to delete the files via `vskill remove`).
 *
 * Kept as a function rather than a flag on `AgentDefinition` so we don't
 * have to mutate 53 registry rows just for this one branching point — and
 * so we can extend the rule (e.g. another agent ships its own settings.json)
 * without a registry migration.
 */
export function classifyAgentSurface(agent: AgentDefinition): AgentSurfaceClass {
  if (agent.id === "claude-code") return "claude-code-style";
  return "auto-discover";
}

// ---------------------------------------------------------------------------
// buildPerAgentReport
// ---------------------------------------------------------------------------

function lineFor(
  agent: AgentDefinition,
  surface: AgentSurfaceClass,
  action: LifecycleAction,
  scope: "user" | "project",
): { action: LifecycleAction; line: string } {
  if (surface === "claude-code-style") {
    switch (action) {
      case "enabled":
        return {
          action: "enabled",
          line: `${agent.displayName} (${scope}) — enabled via claude CLI`,
        };
      case "already-enabled":
        return {
          action: "already-enabled",
          line: `${agent.displayName} (${scope}) — already enabled`,
        };
      case "disabled":
        return {
          action: "disabled",
          line: `${agent.displayName} (${scope}) — disabled via claude CLI`,
        };
      case "already-disabled":
        return {
          action: "already-disabled",
          line: `${agent.displayName} (${scope}) — already disabled`,
        };
      case "not-applicable":
        return {
          action: "not-applicable",
          line: `${agent.displayName} (${scope}) — not applicable`,
        };
    }
  }

  // auto-discover surfaces never need an explicit enable/disable.
  // Map enable/disable to `not-applicable` so machine consumers can detect
  // the no-op uniformly.
  switch (action) {
    case "enabled":
    case "already-enabled":
      return {
        action: "not-applicable",
        line: `${agent.displayName} — auto-discovers from ${agent.localSkillsDir} (no plugin enable needed)`,
      };
    case "disabled":
    case "already-disabled":
      return {
        action: "not-applicable",
        line: `${agent.displayName} — auto-discovers from ${agent.localSkillsDir} (no plugin entry to disable; run vskill remove to stop loading)`,
      };
    case "not-applicable":
      return {
        action: "not-applicable",
        line: `${agent.displayName} — auto-discovers (not applicable)`,
      };
  }
}

/**
 * Walk the supplied agent list and produce one PerAgentReportEntry per
 * agent. Used by `enable`, `disable`, `install`, and `remove` for both
 * human-readable and JSON output.
 *
 * Pure — does not detect agents, does not read settings.json. Callers must
 * pass the already-detected list (via `detectInstalledAgents()`).
 */
export function buildPerAgentReport(
  opts: BuildPerAgentReportOptions,
): PerAgentReportEntry[] {
  return opts.agents.map((agent) => {
    const surface = classifyAgentSurface(agent);
    const { action, line } = lineFor(agent, surface, opts.action, opts.scope);
    return {
      id: agent.id,
      displayName: agent.displayName,
      surface,
      action,
      line,
    };
  });
}
