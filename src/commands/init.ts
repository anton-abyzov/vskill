// ---------------------------------------------------------------------------
// vskill init -- detect agents, create lockfile, sync core skills
// ---------------------------------------------------------------------------

import {
  detectInstalledAgents,
  AGENTS_REGISTRY,
  TOTAL_AGENTS,
} from "../agents/agents-registry.js";
import { readLockfile, writeLockfile, ensureLockfile } from "../lockfile/index.js";
import { filterAgents } from "../utils/agent-filter.js";
import { syncCoreSkills, findCoreSkillsDir } from "../core-skills/sync.js";
import { purgeStalePlugins } from "../settings/index.js";
import { claudePluginUninstall } from "../utils/claude-plugin.js";
import { migrateStaleSkillFiles, ensureSkillMdNaming } from "../installer/migrate.js";
import { resolveAgentSkillsDir } from "../installer/canonical.js";
import { bold, green, dim, cyan, red, table } from "../utils/output.js";

export interface InitOptions {
  agent?: string[];
  copy?: boolean;
}

export async function initCommand(opts: InitOptions = {}): Promise<void> {
  const hasManualAgents = opts.agent && opts.agent.length > 0;

  // When --agent is specified, use the full registry (agent may not be installed locally)
  // Otherwise, auto-detect installed agents
  let agents;
  if (hasManualAgents) {
    try {
      agents = filterAgents(AGENTS_REGISTRY, opts.agent);
      console.log(bold("Using manually specified agents:\n"));
    } catch (err) {
      console.error(red((err as Error).message));
      process.exit(1);
    }
  } else {
    console.log(bold("Detecting installed AI agents...\n"));
    agents = await detectInstalledAgents();
  }

  if (agents.length === 0) {
    console.log(
      dim(`No agents detected out of ${TOTAL_AGENTS} known agents.`)
    );
    console.log(
      dim("Install an AI agent (Claude Code, Cursor, etc.) and re-run.\n")
    );
    console.log(
      dim(`Or specify agents manually: ${cyan("vskill init --agent opencode --agent codex")}`)
    );
  } else {
    const headers = ["Agent", "Company", "Skills Dir"];
    const rows = agents.map((a) => [
      green(a.displayName),
      dim(a.parentCompany || "-"),
      dim(a.localSkillsDir),
    ]);
    console.log(table(headers, rows));
    console.log(
      `\n${green(`${agents.length}`)} agent${agents.length === 1 ? "" : "s"}${hasManualAgents ? " specified" : ` detected out of ${TOTAL_AGENTS} known`}\n`
    );
  }

  // Create or update lockfile
  // Merge agents into existing list (don't overwrite — preserves
  // pruned lists from --agent-filtered installs)
  const agentIds = agents.map((a) => a.id);
  const existing = readLockfile();
  if (existing) {
    existing.agents = [...new Set([...(existing.agents || []), ...agentIds])];
    writeLockfile(existing);
    console.log(dim("Updated existing vskill.lock"));
  } else {
    const lock = ensureLockfile();
    lock.agents = agentIds;
    writeLockfile(lock);
    console.log(green("Created vskill.lock"));
  }

  // Uninstall stale plugins via claude CLI (before Claude Code caches settings)
  const lockForPurge = readLockfile();
  if (lockForPurge?.skills) {
    const staleUser = purgeStalePlugins({ scope: "user" }, lockForPurge.skills);
    const staleProject = purgeStalePlugins(
      { scope: "project", projectDir: process.cwd() },
      lockForPurge.skills,
    );
    const allStale = [
      ...staleUser.map((id) => ({ id, scope: "user" as const })),
      ...staleProject.map((id) => ({ id, scope: "project" as const })),
    ];
    if (allStale.length > 0) {
      console.log(
        dim(`\nRemoving ${allStale.length} stale plugin${allStale.length === 1 ? "" : "s"}:`),
      );
      for (const { id, scope } of allStale) {
        try {
          claudePluginUninstall(id, scope);
          console.log(dim(`  - ${id}`));
        } catch {
          // non-fatal — plugin may not have been registered via claude CLI
        }
      }
    }
  }

  // Migrate stale flat .md files to {name}/SKILL.md subdirectory structure
  if (agents.length > 0) {
    let totalMigrated = 0;
    let totalRemoved = 0;
    for (const agent of agents) {
      try {
        const agentSkillsDir = resolveAgentSkillsDir(agent, {
          global: false,
          projectRoot: process.cwd(),
        });
        const result = migrateStaleSkillFiles(agentSkillsDir);
        totalMigrated += result.migratedCount;
        totalRemoved += result.removedCount;
        // Post-migration enforcement: ensure every skill subdir has SKILL.md
        const naming = ensureSkillMdNaming(agentSkillsDir);
        totalMigrated += naming.renamedCount;
      } catch {
        // Non-fatal — skip migration for this agent
      }
    }
    if (totalMigrated > 0 || totalRemoved > 0) {
      console.log(
        dim(`\nMigrated ${totalMigrated} stale skill file${totalMigrated === 1 ? "" : "s"}, removed ${totalRemoved} duplicate${totalRemoved === 1 ? "" : "s"}`),
      );
    }
  }

  // Sync core SpecWeave skills to all target agents
  if (agents.length > 0) {
    const coreDir = findCoreSkillsDir();
    if (coreDir) {
      const synced = syncCoreSkills(agents, process.cwd(), coreDir);
      if (synced > 0) {
        console.log(
          `\n${green(`${synced}`)} core skill${synced === 1 ? "" : "s"} synced to ${green(`${agents.length}`)} agent${agents.length === 1 ? "" : "s"}`,
        );
      }
    } else {
      console.log(
        dim(`\nCore skills not found. Install the SpecWeave plugin first:`),
      );
      console.log(dim(`  ${cyan("claude plugin install specweave@claude-code")}`));
    }
  }

  console.log(
    dim(`\nRun ${cyan("vskill install <owner/repo>")} to install a skill.`)
  );
}
