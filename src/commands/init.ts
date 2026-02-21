// ---------------------------------------------------------------------------
// vskill install -- detect agents and create lockfile
// ---------------------------------------------------------------------------

import {
  detectInstalledAgents,
  TOTAL_AGENTS,
} from "../agents/agents-registry.js";
import { readLockfile, writeLockfile, ensureLockfile } from "../lockfile/index.js";
import { bold, green, dim, cyan, table } from "../utils/output.js";

export async function initCommand(): Promise<void> {
  console.log(bold("Detecting installed AI agents...\n"));

  const agents = await detectInstalledAgents();

  if (agents.length === 0) {
    console.log(
      dim(`No agents detected out of ${TOTAL_AGENTS} known agents.`)
    );
    console.log(
      dim("Install an AI agent (Claude Code, Cursor, etc.) and re-run.\n")
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
      `\n${green(`${agents.length}`)} agent${agents.length === 1 ? "" : "s"} detected out of ${TOTAL_AGENTS} known\n`
    );
  }

  // Create or update lockfile
  const existing = readLockfile();
  if (existing) {
    existing.agents = agents.map((a) => a.id);
    writeLockfile(existing);
    console.log(dim("Updated existing vskill.lock"));
  } else {
    const lock = ensureLockfile();
    lock.agents = agents.map((a) => a.id);
    writeLockfile(lock);
    console.log(green("Created vskill.lock"));
  }

  console.log(
    dim(`\nRun ${cyan("vskill add <owner/repo>")} to install a skill.`)
  );
}
