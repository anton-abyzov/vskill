// ---------------------------------------------------------------------------
// Claude CLI plugin management delegation
//
// All mutations to ~/.claude/settings.json (enabledPlugins) and the plugin
// cache must go through the claude CLI, never via direct filesystem writes.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { resolveCliBinary } from "./resolve-binary.js";
import { purgeStalePlugins } from "../settings/index.js";

/**
 * Install a marketplace plugin via the claude CLI.
 *
 * Delegates to: claude plugin install --scope <scope> -- <pluginId>
 *
 * This is the only sanctioned way to add entries to settings.json's
 * enabledPlugins field and populate the plugin cache.
 *
 * @throws if the claude binary is not found or the install fails
 */
export function claudePluginInstall(
  pluginId: string,
  scope: "user" | "project" | "local" = "user",
  opts?: { cwd?: string },
): void {
  const claude = resolveCliBinary("claude");
  execFileSync(
    claude,
    ["plugin", "install", "--scope", scope, "--", pluginId],
    { stdio: "pipe", timeout: 30_000, ...(opts?.cwd ? { cwd: opts.cwd } : {}) },
  );
}

/**
 * Uninstall a marketplace plugin via the claude CLI.
 *
 * Delegates to: claude plugin uninstall --scope <scope> -- <pluginId>
 *
 * This is the only sanctioned way to remove entries from settings.json's
 * enabledPlugins field and the associated plugin cache.
 *
 * **Note**: `scope: "project"` operates on the project in `process.cwd()`.
 * Callers must ensure they are in the correct working directory, or pass
 * a `cwd` option to override.
 *
 * @throws if the claude binary is not found — callers should wrap in try/catch
 *         when the plugin may not have been installed via the claude CLI
 */
export function claudePluginUninstall(
  pluginId: string,
  scope: "user" | "project" | "local" = "user",
  opts?: { cwd?: string },
): void {
  const claude = resolveCliBinary("claude");
  execFileSync(
    claude,
    ["plugin", "uninstall", "--scope", scope, "--", pluginId],
    { stdio: "pipe", ...(opts?.cwd ? { cwd: opts.cwd } : {}) },
  );
}

/**
 * Detect and uninstall stale plugins from both user and project scopes.
 *
 * Combines `purgeStalePlugins()` (read-only detection) with
 * `claudePluginUninstall()` (CLI-delegated removal) in a single call.
 *
 * @returns Array of `{ id, scope, ok }` for each stale plugin processed
 */
export function uninstallStalePlugins(
  lockfileSkills: Record<string, { marketplace?: string }>,
  opts?: { log?: (msg: string) => void },
): Array<{ id: string; scope: "user" | "project"; ok: boolean }> {
  const log = opts?.log ?? console.log;
  const staleUser = purgeStalePlugins({ scope: "user" }, lockfileSkills);
  const staleProject = purgeStalePlugins(
    { scope: "project", projectDir: process.cwd() },
    lockfileSkills,
  );
  const allStale = [
    ...staleUser.map((id) => ({ id, scope: "user" as const })),
    ...staleProject.map((id) => ({ id, scope: "project" as const })),
  ];

  const results: Array<{ id: string; scope: "user" | "project"; ok: boolean }> = [];
  for (const { id, scope } of allStale) {
    try {
      claudePluginUninstall(id, scope);
      results.push({ id, scope, ok: true });
    } catch {
      log(`  ${id} (skipped — not registered via CLI)`);
      results.push({ id, scope, ok: false });
    }
  }
  return results;
}
