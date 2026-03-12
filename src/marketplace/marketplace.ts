// ---------------------------------------------------------------------------
// Marketplace.json parser -- parse .claude-plugin/marketplace.json
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export interface MarketplacePlugin {
  name: string;
  source: string;
  version?: string;
  description?: string;
  category?: string;
  author?: { name: string; email?: string; url?: string };
}

export interface MarketplaceOwner {
  name: string;
  email?: string;
  url?: string;
}

export interface MarketplaceManifest {
  name: string;
  owner: MarketplaceOwner;
  plugins: MarketplacePlugin[];
  metadata?: { version?: string; description?: string };
}

// ---- Parser ---------------------------------------------------------------

/**
 * Parse marketplace.json content and extract available plugins.
 *
 * @param content - Raw JSON string from marketplace.json
 * @returns Array of plugin entries, or empty array on parse failure
 */
export function getAvailablePlugins(content: string): MarketplacePlugin[] {
  try {
    const manifest: MarketplaceManifest = JSON.parse(content);
    if (!Array.isArray(manifest.plugins)) return [];
    return manifest.plugins.map((p) => ({
      name: p.name,
      source: p.source,
      version: p.version,
      ...(p.description ? { description: p.description } : {}),
    }));
  } catch {
    return [];
  }
}

/**
 * Get the source path for a named plugin from marketplace.json.
 *
 * @param name - Plugin name to look up (e.g. "frontend")
 * @param content - Raw JSON string from marketplace.json
 * @returns Source path (e.g. "./plugins/frontend") or null
 */
export function getPluginSource(
  name: string,
  content: string,
): string | null {
  const plugins = getAvailablePlugins(content);
  const found = plugins.find((p) => p.name === name);
  return found?.source ?? null;
}

/**
 * Get the version for a named plugin from marketplace.json.
 *
 * @param name - Plugin name to look up
 * @param content - Raw JSON string from marketplace.json
 * @returns Version string or null if not found
 */
export function getPluginVersion(
  name: string,
  content: string,
): string | null {
  const plugins = getAvailablePlugins(content);
  const found = plugins.find((p) => p.name === name);
  return found?.version ?? null;
}

/**
 * Check whether a named plugin exists in marketplace.json.
 *
 * @param name - Plugin name to check (e.g. "sw")
 * @param content - Raw JSON string from marketplace.json
 * @returns true if the plugin exists
 */
export function hasPlugin(name: string, content: string): boolean {
  return getPluginSource(name, content) !== null;
}

/**
 * Get the marketplace name (top-level "name" field) from marketplace.json.
 * Used as the marketplace identifier in `claude plugin install <plugin>@<marketplace>`.
 *
 * @param content - Raw JSON string from marketplace.json
 * @returns Marketplace name (e.g. "specweave") or null
 */
export function getMarketplaceName(content: string): string | null {
  try {
    const manifest: MarketplaceManifest = JSON.parse(content);
    return manifest.name || null;
  } catch {
    return null;
  }
}

// ---- Validation -----------------------------------------------------------

export interface MarketplaceValidation {
  valid: boolean;
  error?: string;
  pluginCount: number;
  name?: string;
}

// ---- Discovery --------------------------------------------------------------

export interface UnregisteredPlugin {
  name: string;
  /** Inferred source path, e.g. "./plugins/marketing" */
  source: string;
}

/**
 * Discover plugin directories in a GitHub repo's plugins/ folder
 * that are NOT listed in marketplace.json.
 *
 * Uses the GitHub Contents API to list immediate children of plugins/.
 * Returns empty array on any API error (best-effort, non-blocking).
 */
export interface UnregisteredPluginResult {
  plugins: UnregisteredPlugin[];
  /** True when the GitHub API call failed (rate limit, network error, etc.) */
  failed: boolean;
}

// ---- Sync -----------------------------------------------------------------

export interface LocalPlugin {
  name: string;
  description?: string;
  version?: string;
  category?: string;
  author?: { name: string; email?: string; url?: string };
}

export interface SyncResult {
  added: string[];
  updated: string[];
  unchanged: string[];
  updatedManifest: MarketplaceManifest;
}

/**
 * Sync marketplace.json against a list of local plugin metadata.
 *
 * Pure function — no filesystem I/O. The caller is responsible for reading
 * marketplace.json and writing the result back.
 *
 * @param manifestContent - Raw JSON string from .claude-plugin/marketplace.json
 * @param localPlugins    - Metadata read from each plugins/*\/.claude-plugin/plugin.json
 * @returns SyncResult with added/updated/unchanged lists and the updated manifest object
 */
export function syncMarketplace(
  manifestContent: string,
  localPlugins: LocalPlugin[],
): SyncResult {
  const manifest: MarketplaceManifest = JSON.parse(manifestContent);
  const result: SyncResult = {
    added: [],
    updated: [],
    unchanged: [],
    updatedManifest: manifest,
  };
  const existing = new Map(manifest.plugins.map((p) => [p.name, p]));

  for (const local of localPlugins) {
    const entry = existing.get(local.name);
    if (!entry) {
      manifest.plugins.push({
        name: local.name,
        source: `./plugins/${local.name}`,
        ...(local.description ? { description: local.description } : {}),
        ...(local.version ? { version: local.version } : {}),
        ...(local.category ? { category: local.category } : {}),
      });
      result.added.push(local.name);
    } else {
      const versionDrift = local.version !== undefined && entry.version !== local.version;
      const descDrift = local.description !== undefined && entry.description !== local.description;
      if (versionDrift || descDrift) {
        if (local.version !== undefined) entry.version = local.version;
        if (local.description !== undefined) entry.description = local.description;
        result.updated.push(local.name);
      } else {
        result.unchanged.push(local.name);
      }
    }
  }
  return result;
}

export async function discoverUnregisteredPlugins(
  owner: string,
  repo: string,
  manifestContent: string,
  onResponse?: (res: Response) => void,
): Promise<UnregisteredPluginResult> {
  const registered = new Set(
    getAvailablePlugins(manifestContent).map((p) => p.name),
  );
  // Also exclude dirs that are registered under a different name but same source path
  const registeredDirs = new Set(
    getAvailablePlugins(manifestContent)
      .map((p) => p.source.replace(/^\.\//, "").replace(/^plugins\//, ""))
      .filter(Boolean),
  );

  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/plugins`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "vskill-cli",
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) {
      onResponse?.(res);
      return { plugins: [], failed: true };
    }

    const entries = (await res.json()) as Array<{ name: string; type: string }>;
    return {
      plugins: entries
        .filter((e) => e.type === "dir" && !registered.has(e.name) && !registeredDirs.has(e.name))
        .map((e) => ({
          name: e.name,
          source: `./plugins/${e.name}`,
        })),
      failed: false,
    };
  } catch {
    return { plugins: [], failed: true };
  }
}

/**
 * Validate marketplace.json content with structured error diagnostics.
 *
 * Unlike `getAvailablePlugins()` (which silently returns []), this function
 * returns specific error reasons for troubleshooting.
 *
 * @param content - Raw JSON string from marketplace.json
 * @returns Validation result with error details
 */
export function validateMarketplace(content: string): MarketplaceValidation {
  try {
    const manifest: MarketplaceManifest = JSON.parse(content);
    if (!manifest.name) {
      return { valid: false, error: "Missing 'name' field", pluginCount: 0 };
    }
    if (!Array.isArray(manifest.plugins)) {
      return { valid: false, error: "Missing or invalid 'plugins' array", pluginCount: 0, name: manifest.name };
    }
    if (manifest.plugins.length === 0) {
      return { valid: false, error: "No plugins defined in marketplace.json", pluginCount: 0, name: manifest.name };
    }
    for (const p of manifest.plugins) {
      if (!p.name || !p.source) {
        return {
          valid: false,
          error: `Plugin entry missing name or source: ${JSON.stringify(p)}`,
          pluginCount: manifest.plugins.length,
          name: manifest.name,
        };
      }
    }
    return { valid: true, pluginCount: manifest.plugins.length, name: manifest.name };
  } catch (err) {
    return { valid: false, error: `Invalid JSON: ${(err as Error).message}`, pluginCount: 0 };
  }
}
