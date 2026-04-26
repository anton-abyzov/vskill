// ---------------------------------------------------------------------------
// 0767 — Orphan plugin-cache cleanup helper.
//
// `claude plugin uninstall <name>` only removes plugins it knows about
// (those listed in `installed_plugins.json`). When a plugin's marketplace
// cache dir survives without an installation entry — e.g. after a partial
// install, an upstream rename, or a manual `installed_plugins.json` edit —
// the Studio's plugin scanner keeps surfacing it as a "ghost" entry. The
// uninstall route falls back to this helper to GC those cache dirs.
//
// Layout assumed:
//   <cacheRoot>/<marketplace>/<plugin-name>/<hash-or-version>/
//
// Path safety: every candidate is verified to resolve under cacheRoot via
// `path.resolve(...).startsWith(cacheRoot + sep)` before any rmSync.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Find every `<cacheRoot>/<marketplace>/<pluginName>/` directory.
 *
 * Returns absolute paths, in `readdir` order. Pure read — no mutations.
 *
 * Quietly returns `[]` for any unsafe input (path-traversal in name, missing
 * cacheRoot, no marketplaces). Callers don't need to pre-validate.
 */
export function listOrphanPluginCacheDirs(
  pluginName: string,
  cacheRoot: string,
): string[] {
  if (!isSafePluginName(pluginName)) return [];
  if (!existsSync(cacheRoot)) return [];

  const cacheRootResolved = resolve(cacheRoot);
  let marketplaces: string[];
  try {
    marketplaces = readdirSync(cacheRootResolved);
  } catch {
    return [];
  }

  const matches: string[] = [];
  for (const mp of marketplaces) {
    const mpDir = join(cacheRootResolved, mp);
    if (!safeStatIsDir(mpDir)) continue;
    const candidate = join(mpDir, pluginName);
    if (!isInside(candidate, cacheRootResolved)) continue;
    if (!safeStatIsDir(candidate)) continue;
    matches.push(candidate);
  }
  return matches;
}

export interface RemovalFailure {
  path: string;
  error: string;
}

export interface RemovalResult {
  removed: string[];
  failed: RemovalFailure[];
}

/**
 * Recursively remove each provided plugin cache directory. Each path is
 * re-validated against cacheRoot before deletion — defense in depth, since
 * the caller may have built the list from a different code path.
 */
export function removeOrphanPluginCacheDirs(
  paths: string[],
  cacheRoot: string,
): RemovalResult {
  const cacheRootResolved = resolve(cacheRoot);
  const removed: string[] = [];
  const failed: RemovalFailure[] = [];

  for (const p of paths) {
    if (!isInside(p, cacheRootResolved)) {
      failed.push({ path: p, error: "path outside cache root" });
      continue;
    }
    try {
      rmSync(p, { recursive: true, force: true });
      removed.push(p);
    } catch (err) {
      failed.push({
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { removed, failed };
}

// Match `claude` plugin-name shape: alphanumerics, dot, dash, underscore.
// Crucially excludes `/`, `\`, `..`, and absolute paths.
const SAFE_PLUGIN_NAME = /^[a-z0-9][\w.-]*$/i;

function isSafePluginName(name: string): boolean {
  if (!name) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === "..") return false;
  return SAFE_PLUGIN_NAME.test(name);
}

function isInside(target: string, root: string): boolean {
  const t = resolve(target);
  return t === root || t.startsWith(root + sep);
}

function safeStatIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
