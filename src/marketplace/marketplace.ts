// ---------------------------------------------------------------------------
// Marketplace.json parser -- parse .claude-plugin/marketplace.json
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export interface MarketplacePlugin {
  name: string;
  source: string;
  version: string;
  description?: string;
}

export interface MarketplaceManifest {
  name: string;
  version: string;
  plugins: MarketplacePlugin[];
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
 * @param name - Plugin name to look up (e.g. "sw-frontend")
 * @param content - Raw JSON string from marketplace.json
 * @returns Source path (e.g. "./plugins/specweave-frontend") or null
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
