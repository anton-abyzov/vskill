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

  // Purge stale plugin entries from settings.json (before Claude Code caches them)
  const lockForPurge = readLockfile();
  if (lockForPurge?.skills) {
    const purgedUser = purgeStalePlugins({ scope: "user" }, lockForPurge.skills);
    const purgedProject = purgeStalePlugins(
      { scope: "project", projectDir: process.cwd() },
      lockForPurge.skills,
    );
    const allPurged = [...purgedUser, ...purgedProject];
    if (allPurged.length > 0) {
      console.log(
        dim(`\nPurged ${allPurged.length} stale plugin${allPurged.length === 1 ? "" : "s"} from settings.json:`),
      );
      for (const id of allPurged) {
        console.log(dim(`  - ${id}`));
      }
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
