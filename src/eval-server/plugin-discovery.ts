// ---------------------------------------------------------------------------
// 0795 — Filesystem-based plugin discovery (replaces `claude plugin list`).
//
// Claude Code removed the `claude plugin list` subcommand. The CLI now only
// exposes install/uninstall/enable/disable/validate/marketplace. The previous
// implementation in plugin-cli-routes.ts and plugin-cli.ts shelled out to
// `list` and 500'd every Studio session.
//
// This module replaces that shell-out with a pure filesystem walk:
//   1. List `<cacheRoot>/<marketplace>/<plugin>/<version>/.claude-plugin/plugin.json`
//   2. Cross-reference with `enabledPlugins` from user + project settings.json
//   3. Emit one `InstalledPlugin` row per (name, marketplace, scope) tuple
//
// Settings.json is read-only here (existing settings/settings.ts policy);
// mutations still go through `claude plugin install/uninstall/enable/disable`,
// which DO exist.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { InstalledPlugin, PluginScope } from "./plugin-cli.js";
import { listEnabledPlugins } from "../settings/settings.js";

export interface DiscoverInstalledPluginsOptions {
  /** Absolute path to the Claude Code plugin cache root. */
  cacheRoot: string;
  /** Project root for project-scoped settings.json. Optional. */
  projectDir?: string;
}

const SAFE_NAME = /^[a-z0-9][\w.-]*$/i;

function isSafeName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  return SAFE_NAME.test(name);
}

function isInside(target: string, root: string): boolean {
  const t = resolve(target);
  return t === root || t.startsWith(root + sep);
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStatIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface CachedPluginRecord {
  marketplace: string;
  name: string;
  version: string;
}

/**
 * Walk the Claude Code plugin cache and return one record per plugin
 * (latest version by mtime when multiple versions are cached).
 */
function walkCache(cacheRoot: string): CachedPluginRecord[] {
  const resolvedRoot = resolve(cacheRoot);
  if (!existsSync(resolvedRoot)) return [];

  const records: CachedPluginRecord[] = [];

  for (const marketplace of safeReadDir(resolvedRoot)) {
    if (!isSafeName(marketplace)) continue;
    const mpDir = join(resolvedRoot, marketplace);
    if (!isInside(mpDir, resolvedRoot) || !safeStatIsDir(mpDir)) continue;

    for (const plugin of safeReadDir(mpDir)) {
      if (!isSafeName(plugin)) continue;
      const pluginDir = join(mpDir, plugin);
      if (!isInside(pluginDir, resolvedRoot) || !safeStatIsDir(pluginDir)) continue;

      // Pick the latest version dir by mtime. Cache layout puts old versions
      // alongside new (claude doesn't GC on update), so showing all of them
      // would duplicate rows in the UI.
      let latest: { version: string; mtime: number } | null = null;
      for (const version of safeReadDir(pluginDir)) {
        if (!isSafeName(version)) continue;
        const versionDir = join(pluginDir, version);
        if (!isInside(versionDir, resolvedRoot) || !safeStatIsDir(versionDir)) continue;
        const manifest = join(versionDir, ".claude-plugin", "plugin.json");
        if (!existsSync(manifest)) continue;
        let mtime = 0;
        try {
          mtime = statSync(versionDir).mtimeMs;
        } catch {
          continue;
        }
        if (!latest || mtime > latest.mtime) {
          latest = { version, mtime };
        }
      }
      if (!latest) continue;

      // Read the manifest so we get the canonical name (the cache dir name
      // can lag behind a rename in the manifest).
      const manifest = join(pluginDir, latest.version, ".claude-plugin", "plugin.json");
      let manifestName = plugin;
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf-8")) as { name?: string };
        if (parsed.name && isSafeName(parsed.name)) manifestName = parsed.name;
      } catch {
        /* fall back to dir name */
      }

      records.push({ marketplace, name: manifestName, version: latest.version });
    }
  }

  return records;
}

/**
 * Build the set of plugin IDs (`<name>@<marketplace>`) enabled at a given
 * scope. Wraps `listEnabledPlugins` so a malformed settings.json never throws.
 */
function readEnabledSet(scope: "user" | "project", projectDir?: string): Set<string> {
  if (scope === "project" && !projectDir) return new Set();
  try {
    const ids = listEnabledPlugins({
      scope,
      ...(scope === "project" && projectDir ? { projectDir } : {}),
    });
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/**
 * Drop-in replacement for `claude plugin list` + `parseInstalledPlugins`.
 *
 * Returns one `InstalledPlugin` row per (name, marketplace, scope) where:
 *   - one row is emitted for each scope where `enabledPlugins[<name>@<marketplace>]: true`
 *   - if the plugin is on disk but not enabled in any scope, one row with
 *     `enabled: false, scope: "user"` is emitted (matches the historical
 *     `claude plugin list` default for unconfigured installs)
 */
export function discoverInstalledPlugins(
  opts: DiscoverInstalledPluginsOptions,
): InstalledPlugin[] {
  const records = walkCache(opts.cacheRoot);
  if (records.length === 0) return [];

  const userEnabled = readEnabledSet("user");
  const projectEnabled = readEnabledSet("project", opts.projectDir);

  const out: InstalledPlugin[] = [];
  for (const r of records) {
    const id = `${r.name}@${r.marketplace}`;
    const inUser = userEnabled.has(id);
    const inProject = projectEnabled.has(id);

    if (inUser) {
      out.push({
        name: r.name,
        marketplace: r.marketplace,
        version: r.version,
        scope: "user" as PluginScope,
        enabled: true,
      });
    }
    if (inProject) {
      out.push({
        name: r.name,
        marketplace: r.marketplace,
        version: r.version,
        scope: "project" as PluginScope,
        enabled: true,
      });
    }
    if (!inUser && !inProject) {
      // On disk but no scope has it enabled — historical CLI behaviour was to
      // show this as a single user-scope, disabled row.
      out.push({
        name: r.name,
        marketplace: r.marketplace,
        version: r.version,
        scope: "user" as PluginScope,
        enabled: false,
      });
    }
  }

  return out;
}
