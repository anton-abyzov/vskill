// ---------------------------------------------------------------------------
// Claude CLI plugin management delegation
//
// All mutations to ~/.claude/settings.json (enabledPlugins) and the plugin
// cache must go through the claude CLI, never via direct filesystem writes.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { resolveCliBinary } from "./resolve-binary.js";

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
