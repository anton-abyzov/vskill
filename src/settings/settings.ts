// ---------------------------------------------------------------------------
// Claude Code settings.json management
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
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
 * Writes settings.json, creating parent directories if needed.
 */
function writeSettings(settings: SettingsJson, opts: SettingsOptions): void {
  const p = settingsPath(opts);
  const dir = dirname(p);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(p, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

/**
 * Enable a plugin in settings.json.
 */
export function enablePlugin(
  pluginId: string,
  opts: SettingsOptions,
): void {
  const settings = readSettings(opts);
  if (!settings.enabledPlugins) {
    settings.enabledPlugins = {};
  }
  settings.enabledPlugins[pluginId] = true;
  writeSettings(settings, opts);
}

/**
 * Disable a plugin in settings.json (set to false).
 */
export function disablePlugin(
  pluginId: string,
  opts: SettingsOptions,
): void {
  const settings = readSettings(opts);
  if (!settings.enabledPlugins) {
    settings.enabledPlugins = {};
  }
  settings.enabledPlugins[pluginId] = false;
  writeSettings(settings, opts);
}

/**
 * Remove a plugin entry entirely from settings.json (vs. setting to false).
 */
export function removePlugin(
  pluginId: string,
  opts: SettingsOptions,
): void {
  const settings = readSettings(opts);
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins[pluginId];
  }
  writeSettings(settings, opts);
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
 * Remove enabledPlugins entries not backed by a lockfile entry.
 *
 * Plugin IDs use `<skillName>@<marketplace>` format.
 * A plugin is stale when no lockfile skill matches by name AND marketplace.
 *
 * Designed for `vskill init` (pre-launch) — runs BEFORE Claude Code
 * loads its in-memory settings cache, preventing ghost re-writes.
 *
 * @returns Array of purged plugin IDs
 */
export function purgeStalePlugins(
  opts: SettingsOptions,
  lockfileSkills: Record<string, { marketplace?: string }>,
): string[] {
  const settings = readSettings(opts);
  if (!settings.enabledPlugins) return [];

  const purged: string[] = [];
  for (const pluginId of Object.keys(settings.enabledPlugins)) {
    const atIdx = pluginId.lastIndexOf("@");
    if (atIdx === -1) continue;

    const skillName = pluginId.slice(0, atIdx);
    const marketplace = pluginId.slice(atIdx + 1);

    const lockEntry = lockfileSkills[skillName];
    if (!lockEntry || lockEntry.marketplace !== marketplace) {
      purged.push(pluginId);
      delete settings.enabledPlugins[pluginId];
    }
  }

  if (purged.length > 0) {
    writeSettings(settings, opts);
  }
  return purged;
}
