// ---------------------------------------------------------------------------
// vskill cleanup -- remove stale plugin entries and orphaned cache
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLockfile } from "../lockfile/index.js";
import { purgeStalePlugins, listEnabledPlugins } from "../settings/index.js";
import { bold, green, dim, yellow } from "../utils/output.js";

export async function cleanupCommand(): Promise<void> {
  console.log(bold("Cleaning up stale plugin entries...\n"));

  const lock = readLockfile();
  const skills = lock?.skills ?? {};

  // Purge stale entries from both user and project settings
  const purgedUser = purgeStalePlugins({ scope: "user" }, skills);
  const purgedProject = purgeStalePlugins(
    { scope: "project", projectDir: process.cwd() },
    skills,
  );
  const allPurged = [...purgedUser, ...purgedProject];

  if (allPurged.length > 0) {
    console.log(
      green(`Purged ${allPurged.length} stale plugin${allPurged.length === 1 ? "" : "s"}:\n`),
    );
    for (const id of allPurged) {
      console.log(`  ${dim(">")} ${id}`);
    }
  } else {
    console.log(dim("No stale plugin entries found in settings.json."));
  }

  // Clean orphaned plugin cache directories
  const cacheBase = join(homedir(), ".claude", "plugins", "cache");
  let orphanedCount = 0;
  if (existsSync(cacheBase)) {
    try {
      for (const marketplace of readdirSync(cacheBase)) {
        const mktDir = join(cacheBase, marketplace);
        for (const pluginName of readdirSync(mktDir)) {
          const lockEntry = skills[pluginName];
          if (!lockEntry || lockEntry.marketplace !== marketplace) {
            const orphanDir = join(mktDir, pluginName);
            try {
              rmSync(orphanDir, { recursive: true, force: true });
              orphanedCount++;
              console.log(dim(`  Removed orphaned cache: ${marketplace}/${pluginName}`));
            } catch {
              // non-fatal
            }
          }
        }
      }
    } catch {
      // non-fatal — cache dir may have permission issues
    }
  }

  if (orphanedCount > 0) {
    console.log(green(`\nRemoved ${orphanedCount} orphaned cache director${orphanedCount === 1 ? "y" : "ies"}.`));
  }

  // Show remaining enabled plugins
  const remaining = listEnabledPlugins({ scope: "user" });
  if (remaining.length > 0) {
    console.log(dim(`\n${remaining.length} enabled plugin${remaining.length === 1 ? "" : "s"} remaining: ${remaining.join(", ")}`));
  }

  if (allPurged.length > 0) {
    console.log(yellow("\nRestart Claude Code to clear its in-memory settings cache."));
  }
}
