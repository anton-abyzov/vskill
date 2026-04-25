// ---------------------------------------------------------------------------
// vskill cleanup -- remove stale plugin entries and orphaned cache
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { readLockfile } from "../lockfile/index.js";
import { listEnabledPlugins, purgeStalePlugins } from "../settings/index.js";
import { uninstallStalePlugins } from "../utils/claude-plugin.js";
import { bold, cyan, green, dim, yellow } from "../utils/output.js";

interface CleanupOptions {
  /** 0724 T-008: dry-run preview, no subprocess. */
  dryRun?: boolean;
}

export async function cleanupCommand(opts: CleanupOptions = {}): Promise<void> {
  const lock = readLockfile();
  const skills = lock?.skills ?? {};
  const inSyncCount = Object.keys(skills).length;

  if (opts.dryRun) {
    // 0724 T-008 (AC-US7-02, AC-US7-03, AC-US7-04): preview-only path.
    // Walk both scopes via the read-only `purgeStalePlugins` helper, then
    // emit the would-be `claude plugin uninstall ...` invocations and the
    // reconciliation summary. No subprocess, no filesystem mutation,
    // settings.json untouched.
    console.log(bold("Dry-run — preview of stale plugin uninstalls:\n"));
    const userStale = purgeStalePlugins({ scope: "user" }, skills);
    const projectStale = purgeStalePlugins(
      { scope: "project", projectDir: process.cwd() },
      skills,
    );
    if (userStale.length === 0 && projectStale.length === 0) {
      console.log(dim("No stale plugin entries found in settings.json."));
    } else {
      for (const id of userStale) {
        console.log(`  ${dim(">")} ${cyan(`claude plugin uninstall --scope user -- ${id}`)}`);
      }
      for (const id of projectStale) {
        console.log(`  ${dim(">")} ${cyan(`claude plugin uninstall --scope project -- ${id}`)}`);
      }
    }
    console.log(
      `\n${green(`${userStale.length}`)} stale entries removed from user scope, ${green(`${projectStale.length}`)} from project scope, ${dim(`${inSyncCount}`)} in-sync skills left untouched.`,
    );
    return;
  }

  console.log(bold("Cleaning up stale plugin entries...\n"));

  // Capture pre-mutation counts for the reconciliation summary.
  const userStale = purgeStalePlugins({ scope: "user" }, skills);
  const projectStale = purgeStalePlugins(
    { scope: "project", projectDir: process.cwd() },
    skills,
  );

  // Uninstall stale plugins via claude CLI
  const results = uninstallStalePlugins(skills);
  if (results.length > 0) {
    console.log(
      green(`Removing ${results.length} stale plugin${results.length === 1 ? "" : "s"}:\n`),
    );
    for (const { id, ok } of results) {
      console.log(`  ${dim(">")} ${id}${ok ? "" : ` ${dim("(skipped — not registered via CLI)")}`}`);
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

  // 0724 T-008 AC-US7-03: reconciliation summary
  console.log(
    `\n${green(`${userStale.length}`)} stale entries removed from user scope, ${green(`${projectStale.length}`)} from project scope, ${dim(`${inSyncCount}`)} in-sync skills left untouched.`,
  );

  // Show remaining enabled plugins
  const remaining = listEnabledPlugins({ scope: "user" });
  if (remaining.length > 0) {
    console.log(dim(`\n${remaining.length} enabled plugin${remaining.length === 1 ? "" : "s"} remaining: ${remaining.join(", ")}`));
  }

  if (results.length > 0) {
    console.log(yellow("\nRestart Claude Code to reload its plugin settings."));
  }
}
