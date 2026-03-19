// ---------------------------------------------------------------------------
// Claude Code settings.json — READ-ONLY access
//
// This module only reads settings.json. All writes must go through the
// claude CLI (claude plugin install/uninstall). Direct filesystem writes
// to settings.json bypass Claude Code's atomicity guarantees and can cause
// race conditions when Claude Code holds the file in memory.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SettingsOptions {
  scope: "user" | "project";
  projectDir?: string;
}

interface SettingsJson {
  enabledPlugins?: Record<string, boolean>;
  [key: string]: unknown;
}

/**
 * Resolves the path to settings.json based on scope.
 * - user: ~/.claude/settings.json
 * - project: <projectDir>/.claude/settings.json
 */
function settingsPath(opts: SettingsOptions): string {
  if (opts.scope === "project" && opts.projectDir) {
    return join(opts.projectDir, ".claude", "settings.json");
  }
  return join(homedir(), ".claude", "settings.json");
}

/**
 * Reads settings.json, returning an empty object if it doesn't exist.
 */
function readSettings(opts: SettingsOptions): SettingsJson {
  const p = settingsPath(opts);
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as SettingsJson;
  } catch {
    return {};
  }
}

/**
 * Check if a plugin is enabled in settings.json.
 */
export function isPluginEnabled(
  pluginId: string,
  opts: SettingsOptions,
): boolean {
  const settings = readSettings(opts);
  return settings.enabledPlugins?.[pluginId] === true;
}

/**
 * List all plugin IDs currently enabled (value === true) in settings.json.
 */
export function listEnabledPlugins(opts: SettingsOptions): string[] {
  const settings = readSettings(opts);
  if (!settings.enabledPlugins) return [];
  return Object.entries(settings.enabledPlugins)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}

/**
 * Identify enabledPlugins entries not backed by a lockfile entry.
 *
 * Plugin IDs use `<skillName>@<marketplace>` format.
 * A plugin is stale when no lockfile skill matches by name AND marketplace.
 *
 * Returns the list of stale plugin IDs — callers are responsible for
 * uninstalling them via `claudePluginUninstall()`.
 *
 * @returns Array of stale plugin IDs
 */
export function purgeStalePlugins(
  opts: SettingsOptions,
  lockfileSkills: Record<string, { marketplace?: string }>,
): string[] {
  const settings = readSettings(opts);
  if (!settings.enabledPlugins) return [];

  const stale: string[] = [];
  for (const pluginId of Object.keys(settings.enabledPlugins)) {
    const atIdx = pluginId.lastIndexOf("@");
    if (atIdx === -1) continue;

    const skillName = pluginId.slice(0, atIdx);
    const marketplace = pluginId.slice(atIdx + 1);

    const lockEntry = lockfileSkills[skillName];
    if (!lockEntry || lockEntry.marketplace !== marketplace) {
      stale.push(pluginId);
    }
  }

  return stale;
}
