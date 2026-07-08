// ---------------------------------------------------------------------------
// Postiz-class manifest conflict detection + healing (0851)
//
// Claude Code refuses to load a plugin when its marketplace entry AND its
// plugin.json BOTH specify component fields (skills/commands/agents/...):
//
//   "Plugin <name> has conflicting manifests: both plugin.json and
//    marketplace entry specify components. Set strict: true in marketplace
//    entry or remove component specs from one location."
//
// Third-party marketplace authors ship this shape regularly (e.g. postiz),
// and every vskill/Skill Studio install that delegates to `claude plugin`
// would surface the loader error through no fault of ours. These helpers
// normalize the cached manifests the way the loader error suggests: set
// `strict: true` on the conflicting entry (plugin.json becomes the single
// source of truth) and drop the entry-level component arrays.
//
// Healing only ever touches LOCAL caches under ~/.claude/plugins — never a
// user's working tree or a remote repo.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Component fields Claude Code treats as "component specs" in a manifest. */
export const COMPONENT_FIELDS = [
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcpServers",
] as const;

type ManifestEntry = Record<string, unknown>;

/** True when the object declares at least one component field. */
export function hasComponentFields(obj: ManifestEntry | null | undefined): boolean {
  if (!obj || typeof obj !== "object") return false;
  return COMPONENT_FIELDS.some((f) => obj[f] !== undefined);
}

export interface HealedEntry {
  /** Plugin name of the healed marketplace entry. */
  plugin: string;
}

export interface HealResult {
  /** Updated JSON content (2-space indent, trailing newline), or null if unchanged. */
  content: string | null;
  healed: HealedEntry[];
}

/**
 * Heal Postiz-class conflicts inside a marketplace.json string.
 *
 * For each plugin entry that (a) declares component fields, (b) does not set
 * `strict: true`, and (c) whose plugin.json — looked up via
 * `pluginHasComponents` — also declares component fields: set `strict: true`
 * and remove the entry-level component fields.
 *
 * Pure apart from the injected lookup. Returns `content: null` when nothing
 * needed healing (callers skip the write).
 */
export function healManifestContent(
  manifestContent: string,
  pluginHasComponents: (entry: { name: string; source: string }) => boolean,
): HealResult {
  let manifest: { plugins?: ManifestEntry[] };
  try {
    manifest = JSON.parse(manifestContent);
  } catch {
    return { content: null, healed: [] };
  }
  if (!Array.isArray(manifest.plugins)) return { content: null, healed: [] };

  const healed: HealedEntry[] = [];
  for (const entry of manifest.plugins) {
    const name = typeof entry.name === "string" ? entry.name : "";
    const source = typeof entry.source === "string" ? entry.source : "";
    if (!name) continue;
    if (entry.strict === true) continue;
    if (!hasComponentFields(entry)) continue;
    if (!pluginHasComponents({ name, source })) continue;

    entry.strict = true;
    for (const field of COMPONENT_FIELDS) delete entry[field];
    healed.push({ plugin: name });
  }

  if (healed.length === 0) return { content: null, healed: [] };
  return { content: JSON.stringify(manifest, null, 2) + "\n", healed };
}

function readJsonSafe(path: string): ManifestEntry | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ManifestEntry;
  } catch {
    return null;
  }
}

/**
 * Heal `<marketplaceDir>/.claude-plugin/marketplace.json` in place, resolving
 * each entry's plugin.json relative to the marketplace root (entry sources
 * are "./" or "./plugins/<name>" style paths).
 *
 * Returns names of healed plugin entries (empty when nothing changed).
 */
export function healMarketplaceDir(marketplaceDir: string): string[] {
  const manifestPath = join(marketplaceDir, ".claude-plugin", "marketplace.json");
  if (!existsSync(manifestPath)) return [];

  const result = healManifestContent(readFileSync(manifestPath, "utf8"), ({ source }) => {
    if (!source) return false;
    const sourceDir = resolve(marketplaceDir, source.replace(/^\.\//, "") || ".");
    // Guard against path escapes in hostile manifests.
    if (!sourceDir.startsWith(resolve(marketplaceDir))) return false;
    return hasComponentFields(readJsonSafe(join(sourceDir, ".claude-plugin", "plugin.json")));
  });

  if (result.content !== null) writeFileSync(manifestPath, result.content, "utf8");
  return result.healed.map((h) => h.plugin);
}

/**
 * Heal the marketplace.json copies inside the plugin cache
 * (`<cacheRoot>/<marketplace>/<plugin>/<version>/.claude-plugin/`).
 *
 * In the cache layout the installed plugin's plugin.json sits NEXT TO the
 * copied marketplace.json, so the conflict check pairs each cached
 * marketplace.json with its sibling plugin.json and heals the entry whose
 * name matches the plugin directory.
 */
export function healPluginCacheDir(cacheRoot: string): string[] {
  const healed: string[] = [];
  if (!existsSync(cacheRoot)) return healed;

  for (const mp of listDirs(cacheRoot)) {
    for (const plugin of listDirs(join(cacheRoot, mp))) {
      for (const version of listDirs(join(cacheRoot, mp, plugin))) {
        const dir = join(cacheRoot, mp, plugin, version, ".claude-plugin");
        const manifestPath = join(dir, "marketplace.json");
        if (!existsSync(manifestPath)) continue;
        const sibling = readJsonSafe(join(dir, "plugin.json"));
        const result = healManifestContent(
          readFileSync(manifestPath, "utf8"),
          ({ name }) => name === plugin && hasComponentFields(sibling),
        );
        if (result.content !== null) {
          writeFileSync(manifestPath, result.content, "utf8");
          healed.push(...result.healed.map((h) => `${mp}/${h.plugin}@${version}`));
        }
      }
    }
  }
  return healed;
}

function listDirs(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export interface HealAllOptions {
  /** Defaults to ~/.claude/plugins/marketplaces */
  marketplacesRoot?: string;
  /** Defaults to ~/.claude/plugins/cache */
  cacheRoot?: string;
}

/**
 * Heal every locally cached marketplace manifest (registered marketplaces +
 * plugin-cache copies). Best-effort and idempotent: safe to call after every
 * `claude plugin marketplace add` / `claude plugin install`. Never throws.
 *
 * Returns human-readable identifiers of healed entries, e.g.
 * `["postiz", "cache: postiz-agent/postiz@2.0.12"]`.
 */
export function healAllMarketplaceManifests(options: HealAllOptions = {}): string[] {
  const healed: string[] = [];
  try {
    const marketplacesRoot =
      options.marketplacesRoot ?? join(homedir(), ".claude", "plugins", "marketplaces");
    for (const mp of listDirs(marketplacesRoot)) {
      try {
        healed.push(...healMarketplaceDir(join(marketplacesRoot, mp)));
      } catch {
        /* best-effort per marketplace */
      }
    }
    const cacheRoot = options.cacheRoot ?? join(homedir(), ".claude", "plugins", "cache");
    healed.push(...healPluginCacheDir(cacheRoot).map((id) => `cache: ${id}`));
  } catch {
    /* never break an install over healing */
  }
  return healed;
}
