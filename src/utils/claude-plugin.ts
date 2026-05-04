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
 * 0826: Add a Claude Code plugin marketplace via the claude CLI.
 *
 * Delegates to: claude plugin marketplace add --scope <scope> -- <source>
 *
 * Required when installing plugins from a marketplace that hasn't been
 * registered yet — `claude plugin install foo@bar` fails with "Plugin foo
 * not found in marketplace bar" until the marketplace itself is added.
 *
 * Safe to call against an already-registered marketplace: claude prints a
 * "marketplace already exists" message and exits 0.
 *
 * @throws if the claude binary is not found or the add fails (network,
 *   invalid source, etc.). Callers should `try/catch` and surface a
 *   user-friendly error.
 */
export function claudePluginMarketplaceAdd(
  source: string,
  scope: "user" | "project" = "user",
): void {
  const claude = resolveCliBinary("claude");
  execFileSync(
    claude,
    ["plugin", "marketplace", "add", "--scope", scope, "--", source],
    { stdio: "pipe", timeout: 180_000 },
  );
}

/**
 * 0826: List Claude Code marketplace names registered with the CLI.
 *
 * Cheap probe used by the install flow to decide whether to call
 * `claudePluginMarketplaceAdd` before `claudePluginInstall`. Returns an
 * empty list (instead of throwing) when claude isn't installed or the
 * subcommand fails — callers fall through to "treat as not registered".
 */
export function claudePluginMarketplaceList(): string[] {
  let claude: string;
  try {
    claude = resolveCliBinary("claude");
  } catch {
    return [];
  }
  let stdout = "";
  try {
    stdout = execFileSync(claude, ["plugin", "marketplace", "list"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).toString("utf-8");
  } catch {
    return [];
  }
  // Format: leading marker (e.g. "❯ "), then name, then "Source: …" line.
  // The marker's exact glyph varies across terminals — match anything that
  // isn't word/whitespace, followed by a name token.
  const names: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("Source:")) continue;
    const m = line.match(/^[^\w\s]+\s+([a-z0-9][\w./:-]*)\s*$/i);
    if (m) names.push(m[1]);
  }
  return names;
}

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
