// ---------------------------------------------------------------------------
// vskill remove -- remove an installed skill from all agents
// ---------------------------------------------------------------------------

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveTilde } from "../utils/paths.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { readLockfile, removeSkillFromLock } from "../lockfile/index.js";
import { claudePluginUninstall } from "../utils/claude-plugin.js";
import { isPluginEnabled } from "../settings/index.js";
import {
  buildPerAgentReport,
  resolvePluginId,
} from "../lib/skill-lifecycle.js";
import { bold, green, red, yellow, dim } from "../utils/output.js";

interface RemoveOptions {
  global?: boolean;
  local?: boolean;
  force?: boolean;
  /** 0724 T-007: structured JSON output (matches enable/disable shape). */
  json?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function removeCommand(
  skillName: string,
  opts: RemoveOptions,
): Promise<void> {
  // Read lockfile to check if skill exists
  const lock = readLockfile();
  const skillEntry = lock?.skills[skillName];

  if (!skillEntry && !opts.force) {
    console.error(
      red(`Skill "${skillName}" not found in lockfile.\n`) +
        dim("Use --force to attempt removal anyway."),
    );
    process.exit(1);
  }

  // Confirmation prompt
  if (!opts.force) {
    const yes = await confirm(
      `Remove skill ${bold(skillName)} from all agents?`,
    );
    if (!yes) {
      console.log(dim("Cancelled."));
      return;
    }
  }

  // Detect installed agents
  const agents = await detectInstalledAgents();
  let removedCount = 0;
  const removedFrom: string[] = [];

  for (const agent of agents) {
    const paths: Array<{ label: string; dir: string }> = [];

    if (!opts.global) {
      // Local dirs
      paths.push({
        label: `${agent.displayName} (local)`,
        dir: join(process.cwd(), agent.localSkillsDir, skillName),
      });
    }

    if (!opts.local) {
      // Global dirs
      paths.push({
        label: `${agent.displayName} (global)`,
        dir: resolveTilde(join(agent.globalSkillsDir, skillName)),
      });
    }

    for (const { label, dir } of paths) {
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true });
          removedFrom.push(label);
          removedCount++;
        } catch (err) {
          console.error(
            yellow(`Failed to remove from ${label}: `) +
              dim((err as Error).message),
          );
        }
      }
    }
  }

  // Update lockfile
  if (skillEntry) {
    removeSkillFromLock(skillName);
  }

  // Uninstall marketplace plugin via claude CLI (handles settings.json + cache)
  // 0724 T-007: replace the legacy free-form "Plugin uninstalled: foo@m" log
  // with the structured per-agent report shared with enable/disable. Behaviour
  // (subprocess invocation, on-disk cleanup, lockfile mutation) is unchanged.
  //
  // F-004 fix: 0724 introduced multi-scope enable/disable, so a skill
  // originally installed at project scope can have a separate user-scope
  // enable. Walk both scopes during remove so we don't leave a dangling
  // enabledPlugins entry that `vskill cleanup` would later flag as stale.
  let pluginId: string | null = null;
  let pluginUninstallOk: boolean | null = null;
  let scope: "user" | "project" = "user";
  if (skillEntry) {
    pluginId = resolvePluginId(skillName, skillEntry);
    scope = skillEntry.scope ?? "user";
    if (pluginId) {
      // F-002 fix: only walk scopes where the plugin is actually enabled
      // (read settings.json once per scope first). This way an "uninstall
      // failed" result truly means the claude CLI failed — not just that
      // the plugin wasn't registered at that scope.
      const cwd = process.cwd();
      const scopeStates: Array<{ s: "user" | "project"; enabled: boolean }> = [
        { s: "user", enabled: false },
        { s: "project", enabled: false },
      ];
      try {
        scopeStates[0].enabled = isPluginEnabled(pluginId, { scope: "user" });
      } catch {
        /* settings.json missing -> treat as not enabled */
      }
      try {
        scopeStates[1].enabled = isPluginEnabled(pluginId, {
          scope: "project",
          projectDir: cwd,
        });
      } catch {
        /* settings.json missing -> treat as not enabled */
      }

      let anyAttempted = false;
      let allOk = true;
      for (const { s, enabled } of scopeStates) {
        if (!enabled) continue;
        anyAttempted = true;
        try {
          claudePluginUninstall(
            pluginId,
            s,
            s === "project" ? { cwd } : undefined,
          );
        } catch {
          allOk = false;
        }
      }
      pluginUninstallOk = anyAttempted ? allOk : null;
    }
  }

  const action = pluginUninstallOk === true ? "disabled" : "not-applicable";
  const perAgent = buildPerAgentReport({
    skill: skillName,
    scope,
    action,
    agents,
  });

  if (opts.json) {
    console.log(
      JSON.stringify({
        skill: skillName,
        scope,
        pluginId,
        pluginUninstallOk,
        removedCount,
        removedFrom,
        perAgent: perAgent.map(({ line: _line, ...rest }) => rest),
      }),
    );
    return;
  }

  // Summary (human-readable)
  if (removedCount > 0) {
    console.log(
      green(`\nRemoved ${bold(skillName)} from ${removedCount} location${removedCount === 1 ? "" : "s"}:\n`),
    );
    for (const loc of removedFrom) {
      console.log(`  ${dim(">")} ${loc}`);
    }
  } else {
    console.log(dim(`\nNo installed files found for "${skillName}".`));
  }

  if (perAgent.length > 0) {
    console.log("");
    for (const r of perAgent) console.log(`  ${dim(">")} ${r.line}`);
  }

  if (pluginId && pluginUninstallOk === false) {
    console.log(
      yellow(`\nPlugin ${pluginId} may still be registered in Claude Code settings.`),
    );
    console.log(dim(`  Run: claude plugin uninstall ${pluginId}`));
  }

  if (skillEntry) {
    console.log(dim("\nLockfile updated."));
  }
}
