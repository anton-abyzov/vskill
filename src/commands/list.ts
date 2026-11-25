// ---------------------------------------------------------------------------
// vskill list -- show installed skills or detected agents
// ---------------------------------------------------------------------------

import { readLockfile, readSkillsShLock } from "../lockfile/index.js";
import { globalLockDir, mergedSkills, resolveLockTargets, type LockResolution } from "../lockfile/scope.js";
import type { VskillLock } from "../lockfile/types.js";
import {
  detectInstalledAgents,
  AGENTS_REGISTRY,
} from "../agents/agents-registry.js";
import { isPluginEnabled } from "../settings/index.js";
import { resolvePluginId } from "../lib/skill-lifecycle.js";
import { bold, green, red, dim, cyan, yellow, table } from "../utils/output.js";
import { collectDeprecations, deprecationJson, deprecationNotice, type DeprecationFinding } from "../lib/deprecation.js";

interface ListOptions {
  agents?: boolean;
  /** 0724 T-005: per-scope enable status table. */
  installed?: boolean;
  json?: boolean;
  /** List user-level installs (~/.agents/vskill.lock) instead of the project's. */
  global?: boolean;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  if (opts.installed) {
    await listInstalledWithStatus(opts.json, opts.global);
    return;
  }
  if (opts.agents) {
    await listAgents(opts.json);
  } else {
    await listSkills(opts.json, opts.global);
  }
}

/**
 * The lock entries `list` shows: the project lock, or the user-level lock
 * with --global or outside a project. Notes go to stderr so --json stays
 * parseable. Exits when no lockfile exists.
 */
function readListLock(global?: boolean): { skills: VskillLock["skills"]; resolution: LockResolution } | null {
  const resolution = resolveLockTargets({ global, read: readLockfile });
  if (resolution.targets.length === 0) {
    console.log(
      yellow("No vskill.lock found. Run ") +
        cyan(resolution.scope === "global" ? "vskill install <source> --global" : "vskill install") +
        yellow(" first.")
    );
    if (resolution.scope === "project") {
      console.log(dim(`User-level skills: ${cyan("vskill list --global")}`));
    }
    process.exit(1);
    return null; // unreachable but satisfies TS
  }
  if (resolution.fellBackToGlobal) {
    console.error(dim(`No project vskill.lock here; listing user-level skills from ${resolution.displayPath}`));
  } else if (resolution.scope === "global") {
    console.error(dim(`User-level skills from ${resolution.displayPath}`));
  }
  return { skills: mergedSkills(resolution.targets), resolution };
}

/**
 * 1486: deprecations the installed copies declare, keyed by lock name. Disk
 * only (no network): `vskill outdated` and `vskill doctor` read the sources.
 */
async function installedDeprecations(
  skills: VskillLock["skills"],
  resolution: LockResolution,
): Promise<Map<string, DeprecationFinding[]>> {
  const dirOf = new Map<string, string>();
  for (const t of resolution.targets) for (const n of t.names) if (!dirOf.has(n)) dirOf.set(n, t.dir);
  const findings = await collectDeprecations(
    Object.entries(skills).map(([name, entry]) => ({ name, entry, lockDir: dirOf.get(name) ?? resolution.projectDir })),
  ).catch(() => [] as DeprecationFinding[]);
  const byName = new Map<string, DeprecationFinding[]>();
  for (const f of findings) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  return byName;
}

function printDeprecationNotices(byName: Map<string, DeprecationFinding[]>): void {
  const all = [...byName.values()].flat();
  if (all.length === 0) return;
  console.log("");
  for (const f of all) console.log(deprecationNotice(f.skill, f.deprecation));
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

async function listSkills(json?: boolean, global?: boolean): Promise<void> {
  const read = readListLock(global);
  if (!read) return;
  const lock = { skills: read.skills };

  const skillNames = Object.keys(lock.skills);
  const deprecated = await installedDeprecations(lock.skills, read.resolution);

  if (json) {
    const out: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(lock.skills)) {
      const found = deprecated.get(name);
      out[name] = found
        ? { ...entry, deprecations: found.map((f) => ({ skill: f.skill, ...deprecationJson(f.deprecation) })) }
        : entry;
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Also read skills.sh lock file for cross-tool visibility (its global
  // installs keep their lock next to ours in ~/.agents).
  const skillsShEntries = read.resolution.scope === "global"
    ? readSkillsShLock(globalLockDir())
    : readSkillsShLock();
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
      bold(name) + (deprecated.has(name) ? ` ${yellow("(deprecated)")}` : ""),
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
  printDeprecationNotices(deprecated);
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
  deprecations?: Array<{ skill: string; message: string; replacedBy: string; since?: string }>;
}

async function listInstalledWithStatus(json?: boolean, global?: boolean): Promise<void> {
  const read = readListLock(global);
  if (!read) return;
  const lock = { skills: read.skills };

  const skillNames = Object.keys(lock.skills);
  const cwd = process.cwd();
  const deprecated = await installedDeprecations(lock.skills, read.resolution);

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

  for (const row of rowsData) {
    const found = deprecated.get(row.name);
    if (found) row.deprecations = found.map((f) => ({ skill: f.skill, ...deprecationJson(f.deprecation) }));
  }

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
    const name = bold(r.name) + (r.deprecations ? ` ${yellow("(deprecated)")}` : "");
    return [name, r.version, dim(r.source), userCell, projectCell];
  });
  console.log(table(headers, rows));
  printDeprecationNotices(deprecated);
}
