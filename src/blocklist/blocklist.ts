// ---------------------------------------------------------------------------
// Blocklist module — malicious skills registry client with local cache
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { BlocklistEntry, BlocklistCache, InstallSafetyResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DIR = join(homedir(), ".vskill");
const CACHE_FILE = join(CACHE_DIR, "blocklist.json");
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_API_URL = "https://verified-skill.com";

function getApiBaseUrl(): string {
  return process.env.VSKILL_API_URL || DEFAULT_API_URL;
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

/**
 * Read the cached blocklist from disk.
 * Returns null if the cache file does not exist or is corrupted.
 */
export function getCachedBlocklist(): BlocklistCache | null {
  if (!existsSync(CACHE_FILE)) return null;

  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as BlocklistCache;
  } catch {
    return null;
  }
}

/**
 * Check whether the cached blocklist is older than the stale threshold (1 hour).
 */
export function isBlocklistStale(cache: BlocklistCache): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  if (isNaN(fetchedAt)) return true;
  return Date.now() - fetchedAt > STALE_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// API operations
// ---------------------------------------------------------------------------

/**
 * Fetch the full blocklist from the API and write it to the local cache.
 */
export async function syncBlocklist(): Promise<BlocklistCache> {
  const url = `${getApiBaseUrl()}/api/v1/blocklist`;

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Blocklist API error: ${res.status}`);
  }

  const data = await res.json() as {
    entries: BlocklistEntry[];
    count: number;
    lastUpdated: string;
  };

  const etag = res.headers.get("etag") || undefined;

  const cache: BlocklistCache = {
    entries: data.entries,
    count: data.count,
    lastUpdated: data.lastUpdated,
    fetchedAt: new Date().toISOString(),
    etag,
  };

  // Ensure cache directory exists
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");

  return cache;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Find a matching entry in the blocklist by skill name or content hash.
 */
function findEntry(
  entries: BlocklistEntry[],
  skillName: string,
  contentHash?: string,
): BlocklistEntry | null {
  for (const entry of entries) {
    if (entry.skillName === skillName) return entry;
    if (contentHash && entry.contentHash && entry.contentHash === contentHash) {
      return entry;
    }
  }
  return null;
}

/**
 * Check whether a skill is on the blocklist.
 *
 * 1. Check local cache first.
 * 2. If cache is stale, attempt to refresh from the API.
 * 3. If the API is unreachable, fall back to the stale cache.
 * 4. Returns the matching BlocklistEntry or null if not blocked.
 */
export async function checkBlocklist(
  skillName: string,
  contentHash?: string,
): Promise<BlocklistEntry | null> {
  let cache = getCachedBlocklist();

  if (cache && !isBlocklistStale(cache)) {
    return findEntry(cache.entries, skillName, contentHash);
  }

  // Cache is stale or missing — try to refresh
  try {
    cache = await syncBlocklist();
  } catch {
    // API unreachable — fall back to stale cache if available
    if (cache) {
      return findEntry(cache.entries, skillName, contentHash);
    }
    return null;
  }

  return findEntry(cache.entries, skillName, contentHash);
}

/**
 * Check install safety via the platform API (blocklist + rejection status).
 *
 * Makes a single HTTP call to GET /api/v1/blocklist/check?name=X.
 * Falls back to local checkBlocklist() when the API is unreachable
 * (graceful degradation: rejected=false).
 */
export async function checkInstallSafety(
  skillName: string,
  contentHash?: string,
): Promise<InstallSafetyResult> {
  try {
    const url = `${getApiBaseUrl()}/api/v1/blocklist/check?name=${encodeURIComponent(skillName)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      // API error — fall back to local blocklist check
      const entry = await checkBlocklist(skillName, contentHash);
      return { blocked: !!entry, entry: entry ?? undefined, rejected: false };
    }

    const data = (await res.json()) as InstallSafetyResult;
    return data;
  } catch {
    // Network error — fall back to local blocklist check
    const entry = await checkBlocklist(skillName, contentHash);
    return { blocked: !!entry, entry: entry ?? undefined, rejected: false };
  }
}
