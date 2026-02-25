// ---------------------------------------------------------------------------
// vskill list -- show installed skills or detected agents
// ---------------------------------------------------------------------------

import { readLockfile, readSkillsShLock } from "../lockfile/index.js";
import {
  detectInstalledAgents,
  AGENTS_REGISTRY,
} from "../agents/agents-registry.js";
import { bold, green, red, dim, cyan, yellow, table } from "../utils/output.js";

interface ListOptions {
  agents?: boolean;
  json?: boolean;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  if (opts.agents) {
    await listAgents(opts.json);
  } else {
    await listSkills(opts.json);
  }
}

async function listAgents(json?: boolean): Promise<void> {
  const installed = await detectInstalledAgents();
  const installedIds = new Set(installed.map((a) => a.id));

  if (json) {
    const data = AGENTS_REGISTRY.map((a) => ({
      id: a.id,
      name: a.displayName,
      company: a.parentCompany || null,
      installed: installedIds.has(a.id),
      universal: a.isUniversal,
      localDir: a.localSkillsDir,
    }));
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`AI Agents (${AGENTS_REGISTRY.length} known)\n`));

  const headers = ["Status", "Agent", "Company", "Type"];
  const rows = AGENTS_REGISTRY.map((a) => [
    installedIds.has(a.id) ? green("*") : dim("-"),
    installedIds.has(a.id) ? bold(a.displayName) : a.displayName,
    dim(a.parentCompany || "-"),
    a.isUniversal ? cyan("universal") : dim("custom"),
  ]);

  console.log(table(headers, rows));
  console.log(
    `\n${green(`${installed.length}`)} installed  ${dim(`${AGENTS_REGISTRY.length} total`)}`
  );
}

async function listSkills(json?: boolean): Promise<void> {
  const lock = readLockfile();

  if (!lock) {
    console.log(
      yellow("No vskill.lock found. Run ") +
        cyan("vskill install") +
        yellow(" first.")
    );
    process.exit(1);
    return; // unreachable but satisfies TS
  }

  const skillNames = Object.keys(lock.skills);

  if (json) {
    console.log(JSON.stringify(lock.skills, null, 2));
    return;
  }

  // Also read skills.sh lock file for cross-tool visibility
  const skillsShEntries = readSkillsShLock();
  const skillsShNames = new Set(skillsShEntries.map((e) => e.name));

  if (skillNames.length === 0 && skillsShNames.size === 0) {
    console.log(dim("No skills installed yet."));
    console.log(
      dim(`Run ${cyan("vskill install <owner/repo>")} to install a skill.`)
    );
    return;
  }

  const totalCount = skillNames.length + [...skillsShNames].filter((n) => !lock.skills[n]).length;
  console.log(bold(`Installed Skills (${totalCount})\n`));

  const headers = ["Skill", "Version", "Tier", "Source", "Installed"];
  const rows = skillNames.map((name) => {
    const s = lock.skills[name];
    const tierColor =
      s.tier === "CERTIFIED"
        ? yellow
        : s.tier === "VERIFIED"
          ? green
          : dim;
    return [
      bold(name),
      s.version || "-",
      tierColor(s.tier || "VERIFIED"),
      dim(s.source || "-"),
      dim(s.installedAt ? new Date(s.installedAt).toLocaleDateString() : "-"),
    ];
  });

  // Append skills from .skill-lock.json that aren't already in vskill.lock
  for (const entry of skillsShEntries) {
    if (!lock.skills[entry.name]) {
      rows.push([
        bold(entry.name),
        "-",
        dim("VERIFIED"),
        dim("skills.sh"),
        dim("-"),
      ]);
    }
  }

  console.log(table(headers, rows));
}
