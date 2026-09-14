// Reconcile missing plugin registrations without claiming ownership of
// plugins installed by Claude, Codex, another project, or another installer.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLockfile } from "../lockfile/index.js";
import { getProjectRoot } from "../lockfile/project-root.js";
import { purgeStalePlugins } from "../settings/index.js";
import { claudePluginUninstall } from "../utils/claude-plugin.js";
import { bold, cyan, green, dim, yellow } from "../utils/output.js";

interface CleanupOptions { dryRun?: boolean }
type Scope = "user" | "project";

/** Absence from vskill.lock alone is not evidence of an orphan. */
function registeredPluginIds(): Set<string> | null {
  const registry = join(homedir(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync(registry)) return new Set();
  try {
    const data = JSON.parse(readFileSync(registry, "utf8"));
    if (!data?.plugins || typeof data.plugins !== "object" || Array.isArray(data.plugins)) return null;
    return new Set(Object.keys(data.plugins));
  } catch {
    // Unreadable ownership data must never become a removal plan.
    return null;
  }
}

function hasCachedPlugin(id: string): boolean {
  const at = id.lastIndexOf("@");
  const name = id.slice(0, at);
  const marketplace = id.slice(at + 1);
  const safe = /^[a-z0-9][\w.-]*$/i;
  if (at < 1 || !safe.test(name) || !safe.test(marketplace)) return true;
  return existsSync(join(homedir(), ".claude", "plugins", "cache", marketplace, name));
}

export async function cleanupCommand(opts: CleanupOptions = {}): Promise<void> {
  const projectRoot = getProjectRoot();
  const projectSkills = readLockfile()?.skills ?? {};
  // Older global installs wrote ~/vskill.lock; current installs use ~/.agents.
  const userSkills = {
    ...(readLockfile(homedir())?.skills ?? {}),
    ...(readLockfile(join(homedir(), ".agents"))?.skills ?? {}),
  };
  const registered = registeredPluginIds();
  if (registered === null) {
    console.log(yellow("Plugin registry unreadable. Cleanup skipped; no files or registrations changed."));
    return;
  }
  const plans: Array<{ id: string; scope: Scope }> = [];
  for (const scope of ["user", "project"] as const) {
    const settings = scope === "user" ? { scope } : { scope, projectDir: projectRoot };
    const skills = scope === "user" ? userSkills : projectSkills;
    for (const id of purgeStalePlugins(settings, skills)) {
      if (!registered.has(id) && !hasCachedPlugin(id)) plans.push({ id, scope });
    }
  }

  const inSyncCount = new Set([...Object.keys(projectSkills), ...Object.keys(userSkills)]).size;
  if (opts.dryRun) {
    console.log(bold("Dry-run — preview of missing plugin registration cleanup:\n"));
    for (const { id, scope } of plans) {
      console.log(`  ${dim(">")} ${cyan(`claude plugin uninstall --scope ${scope} -- ${id}`)}`);
    }
    if (!plans.length) console.log(dim("No stale plugin entries found in settings.json."));
    const user = plans.filter((p) => p.scope === "user").length;
    const project = plans.filter((p) => p.scope === "project").length;
    console.log(`\n${user} user and ${project} project entries would be removed; no changes made. ${inSyncCount} in-sync skills left untouched.`);
    return;
  }

  console.log(bold("Cleaning up missing plugin registrations...\n"));
  const removed = { user: 0, project: 0 };
  for (const { id, scope } of plans) {
    try {
      claudePluginUninstall(id, scope, scope === "project" ? { cwd: projectRoot } : undefined);
      removed[scope]++;
      console.log(dim(`  Removed missing registration: ${id} (${scope})`));
    } catch {
      console.log(yellow(`  ${id} (${scope}) could not be uninstalled; registration retained.`));
    }
  }
  // Cache is shared with other projects and installers. Only a targeted
  // uninstall can establish ownership; blanket lockfile-based GC is unsafe.
  console.log(`\n${green(String(removed.user))} stale entries removed from user scope, ${green(String(removed.project))} from project scope, ${inSyncCount} in-sync skills left untouched.`);
  console.log(dim("Shared plugin caches preserved. Use a targeted uninstall to remove a plugin."));
}
