// ---------------------------------------------------------------------------
// 0769 T-006: SkillDirRegistry — server-side memo of (plugin, skill) → absolute
// skill directory, plus the editable upstream sourcePath when known.
//
// Populated each time the /api/skills handler enriches the scanner output;
// consumed by the /files and /file routes so they can serve plugin-cache
// installs whose skill directory lives OUTSIDE the studio's project root.
// ---------------------------------------------------------------------------

export interface SkillDirEntry {
  /** Absolute path to the skill directory the scanner emitted. */
  dir: string;
  /**
   * Optional editable upstream source path (marketplace clone for plugin-cache
   * installs). Stored for future use by routes that prefer the editable copy.
   */
  sourcePath?: string | null;
  /** Origin classification, mostly informational. */
  origin?: "source" | "installed";
}

const ENTRIES = new Map<string, SkillDirEntry>();

function key(plugin: string, skill: string): string {
  return `${plugin}/${skill}`;
}

/** Replace any existing entry for (plugin, skill). */
export function setSkillDirEntry(
  plugin: string,
  skill: string,
  entry: SkillDirEntry,
): void {
  ENTRIES.set(key(plugin, skill), entry);
}

/** Look up an entry. Returns undefined when nothing is registered. */
export function getSkillDirEntry(plugin: string, skill: string): SkillDirEntry | undefined {
  return ENTRIES.get(key(plugin, skill));
}

/** Clear the registry — used in tests. */
export function clearSkillDirRegistry(): void {
  ENTRIES.clear();
}

/**
 * 0769 F-002: lazy registry repopulation for cold-server deep links.
 *
 * The /api/skills handler populates the registry as a side-effect of listing
 * skills, so the file/files routes always have an entry once the user has
 * loaded the sidebar. But a fresh server that receives a direct
 * /api/skills/:plugin/:skill/files request first (e.g. browser refresh on a
 * deep-linked detail page) sees an empty registry and would 404.
 *
 * This helper bridges that gap: on registry miss, run scanInstalledPluginSkills
 * once, populate every plugin-cache entry it returns, and return the matching
 * entry. Memoization happens via the registry itself — repeat calls hit the
 * fast path. Returns undefined if no plugin-cache skill matches.
 *
 * F-003 (followup): cache the LAST scan's epoch so we don't re-walk the entire
 * ~/.claude/plugins/cache tree on every miss. Hostile or buggy clients hammering
 * /api/skills/:bogus/:bogus/files would otherwise amplify into a full disk scan
 * per request. Default throttle: at most one full scan per 30s window.
 */
let lastScanAt = 0;
const SCAN_THROTTLE_MS = 30_000;

export async function ensurePluginCacheEntry(
  plugin: string,
  skill: string,
): Promise<SkillDirEntry | undefined> {
  const hit = getSkillDirEntry(plugin, skill);
  if (hit) return hit;

  // F-003: throttle repeated misses — within the window, return undefined
  // immediately instead of re-scanning. The route handler then 404s, which
  // is the correct response for "skill not found" anyway.
  const now = Date.now();
  if (now - lastScanAt < SCAN_THROTTLE_MS) return undefined;
  lastScanAt = now;

  // Lazy import to avoid a server-startup cycle (this module is consumed by
  // routes that the plugin-scanner module doesn't import back, and vice
  // versa — keeping the import inside the function preserves that property).
  const { scanInstalledPluginSkills } = await import("../eval/plugin-scanner.js");
  const skills = scanInstalledPluginSkills({ agentId: "claude-code" });
  for (const s of skills) {
    if (s.plugin && s.skill && s.dir) {
      setSkillDirEntry(s.plugin, s.skill, {
        dir: s.dir,
        sourcePath: s.sourcePath ?? null,
        origin: s.origin,
      });
    }
  }
  return getSkillDirEntry(plugin, skill);
}

/** Test-only: reset the scan throttle so unit tests don't see stale state. */
export function resetEnsureScanThrottle(): void {
  lastScanAt = 0;
}
