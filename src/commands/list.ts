// ---------------------------------------------------------------------------
// vskill list -- show installed skills or detected agents
// ---------------------------------------------------------------------------

import { readLockfile, readSkillsShLock } from "../lockfile/index.js";
import {
  detectInstalledAgents,
  AGENTS_REGISTRY,
} from "../agents/agents-registry.js";
import { isPluginEnabled } from "../settings/index.js";
import { resolvePluginId } from "../lib/skill-lifecycle.js";
import { bold, green, red, dim, cyan, yellow, table } from "../utils/output.js";

interface ListOptions {
  agents?: boolean;
  /** 0724 T-005: per-scope enable status table. */
  installed?: boolean;
  json?: boolean;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  if (opts.installed) {
    await listInstalledWithStatus(opts.json);
    return;
  }
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

// ---------------------------------------------------------------------------
// 0724 T-005: vskill list --installed
//
// Joins vskill.lock with `enabledPlugins` reads at user scope and project
// scope (cwd), producing a table or JSON array with explicit
// `enabled / disabled / n/a` per scope.
// ---------------------------------------------------------------------------

interface InstalledRow {
  name: string;
  version: string;
  source: string;
  enabledUser: boolean;
  enabledProject: boolean;
  autoDiscovered: boolean;
}

async function listInstalledWithStatus(json?: boolean): Promise<void> {
  const lock = readLockfile();

  if (!lock) {
    console.log(
      yellow("No vskill.lock found. Run ") +
        cyan("vskill install") +
        yellow(" first."),
    );
    process.exit(1);
    return;
  }

  const skillNames = Object.keys(lock.skills);
  const cwd = process.cwd();

  const rowsData: InstalledRow[] = skillNames.map((name) => {
    const entry = lock.skills[name];
    const pluginId = resolvePluginId(name, entry);
    if (pluginId === null) {
      return {
        name,
        version: entry.version || "-",
        source: entry.source || "-",
        enabledUser: false,
        enabledProject: false,
        autoDiscovered: true,
      };
    }
    let enabledUser = false;
    let enabledProject = false;
    try {
      enabledUser = isPluginEnabled(pluginId, { scope: "user" });
    } catch {
      enabledUser = false;
    }
    try {
      enabledProject = isPluginEnabled(pluginId, {
        scope: "project",
        projectDir: cwd,
      });
    } catch {
      enabledProject = false;
    }
    return {
      name,
      version: entry.version || "-",
      source: entry.source || "-",
      enabledUser,
      enabledProject,
      autoDiscovered: false,
    };
  });

  if (json) {
    console.log(JSON.stringify(rowsData, null, 2));
    return;
  }

  if (rowsData.length === 0) {
    console.log(dim("No skills installed yet."));
    console.log(
      dim(`Run ${cyan("vskill install <owner/repo>")} to install a skill.`),
    );
    return;
  }

  console.log(bold(`Installed Skills (${rowsData.length})\n`));

  const headers = ["Skill", "Version", "Source", "User Scope", "Project Scope"];
  const rows = rowsData.map((r) => {
    const userCell = r.autoDiscovered
      ? dim("n/a")
      : r.enabledUser
        ? green("enabled")
        : red("disabled");
    const projectCell = r.autoDiscovered
      ? dim("n/a")
      : r.enabledProject
        ? green("enabled")
        : red("disabled");
    return [bold(r.name), r.version, dim(r.source), userCell, projectCell];
  });
  console.log(table(headers, rows));
}
