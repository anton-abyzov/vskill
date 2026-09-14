// ---------------------------------------------------------------------------
// vskill remove -- remove an installed skill from all agents
// ---------------------------------------------------------------------------

import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { resolveTilde } from "../utils/paths.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";
import { readLockfile, removeSkillFromLock } from "../lockfile/index.js";
import { getProjectRoot } from "../lockfile/project-root.js";
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
  const globalAgentsRoot = resolveTilde("~/.agents");
  const projectRoot = getProjectRoot();
  const lock = readLockfile(opts.global ? globalAgentsRoot : undefined);
  const projectEntry = opts.global ? undefined : lock?.skills[skillName];
  const globalLock = opts.local ? null : opts.global ? lock : readLockfile(globalAgentsRoot);
  let globalEntry = globalLock?.skills[skillName];
  let globalLockRoot = globalAgentsRoot;
  if (!opts.local && !globalEntry) {
    const legacyRoot = dirname(globalAgentsRoot);
    globalEntry = readLockfile(legacyRoot)?.skills[skillName];
    if (globalEntry) globalLockRoot = legacyRoot;
  }
  const skillEntry = projectEntry ?? globalEntry;

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
  // F5: track which agents actually had files deleted so the per-agent
  // report can say "removed" instead of "not-applicable" for them.
  const removedAgentIds = new Set<string>();

  for (const agent of agents) {
    const paths: Array<{ label: string; dir: string }> = [];

    if (!opts.global) {
      // Local dirs
      paths.push({
        label: `${agent.displayName} (local)`,
        dir: join(projectRoot, agent.localSkillsDir, skillName),
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
          removedAgentIds.add(agent.id);
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
  if (projectEntry) {
    removeSkillFromLock(skillName);
  }

  // F5: clean up the canonical .agents/skills/<name> payload that
  // installSymlink() writes. The loop above only deletes per-agent
  // copies/symlinks — without this, the canonical store (the symlink
  // target) is stranded on disk forever.
  if (!opts.local && globalEntry) {
    // Global installs keep their lockfile at ~/.agents/vskill.lock; drop the
    // entry there too since the loop above deleted the global agent files.
    removeSkillFromLock(skillName, globalLockRoot);
  }

  const canonicalTargets: Array<{ label: string; dir: string; lockDir?: string }> = [];
  if (!opts.global) {
    canonicalTargets.push({
      label: "canonical store (project)",
      dir: join(projectRoot, ".agents", "skills", skillName),
    });
  }
  if (!opts.local) {
    canonicalTargets.push({
      label: "canonical store (global)",
      dir: join(globalAgentsRoot, "skills", skillName),
      lockDir: globalLockRoot,
    });
  }
  for (const { label, dir, lockDir } of canonicalTargets) {
    // Only delete the payload once no lockfile entry references it.
    if (readLockfile(lockDir)?.skills[skillName]) continue;
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removedFrom.push(label);
      removedCount++;
    } catch (err) {
      console.error(
        yellow(`Failed to remove ${label}: `) + dim((err as Error).message),
      );
    }
  }

  // Resolve each scope independently: the same name can come from different
  // marketplaces, or be a plain skill in one scope and a plugin in another.
  const scope: "user" | "project" = opts.local ? "project" : opts.global ? "user" : skillEntry?.scope ?? "user";
  const scopedEntries = [
    { scope: "user" as const, entry: globalEntry ?? (projectEntry?.scope === "user" ? projectEntry : undefined), allowed: !opts.local },
    { scope: "project" as const, entry: projectEntry, allowed: !opts.global },
  ];
  const pluginIds: string[] = [];
  let anyAttempted = false;
  let allOk = true;
  for (const target of scopedEntries) {
    if (!target.allowed || !target.entry) continue;
    const id = resolvePluginId(skillName, target.entry);
    if (!id) continue;
    pluginIds.push(id);
    const cwd = projectRoot;
    try {
      const settings = target.scope === "user"
        ? { scope: target.scope }
        : { scope: target.scope, projectDir: cwd };
      if (!isPluginEnabled(id, settings)) continue;
      anyAttempted = true;
      claudePluginUninstall(id, target.scope, target.scope === "project" ? { cwd } : undefined);
    } catch {
      allOk = false;
    }
  }
  const pluginId = pluginIds[0] ?? null;
  const pluginUninstallOk = anyAttempted ? allOk : null;

  const action = pluginUninstallOk === true ? "disabled" : "not-applicable";
  const perAgent = buildPerAgentReport({
    skill: skillName,
    scope,
    action,
    // F5: agents whose files we deleted report "removed" — previously they
    // all inherited the plugin-uninstall action and showed "not-applicable".
    actionFor: (agent) => (removedAgentIds.has(agent.id) ? "removed" : action),
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
