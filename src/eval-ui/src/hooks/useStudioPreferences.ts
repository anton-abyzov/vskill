// ---------------------------------------------------------------------------
// T-060: useStudioPreferences — studio-wide user preference helpers.
//
// Persistence strategy (initial):
//   - All keys live under a single `localStorage` entry (JSON object).
//   - Reads and writes fail-soft: unavailable storage, bad JSON, quota
//     errors, etc. never propagate exceptions to callers.
//
// BLOCKING_ISSUE: The team-lead spec calls for a project-local
//   `.vskill/studio.json` persisted via the eval-server so preferences
//   survive across browsers. That requires a `POST /api/prefs` endpoint
//   which does not exist today. Until that endpoint ships, this hook is
//   localStorage-only (single-browser). The write side is already shaped
//   to be upgraded into a fetch call without touching callers.
// ---------------------------------------------------------------------------

export const STUDIO_PREFS_KEY = "vskill.studio.prefs";

export interface StudioPreferences {
  /** Currently-selected LLM model id (e.g., "anthropic/claude-4.6-sonnet"). */
  selectedModel?: string;
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed?: boolean;
  /**
   * 0678 — Last-chosen source model for skill generation on the Create Skill
   * page. Persisted so the dropdown remembers the user's pick across reloads
   * and tabs. Shape is `{ provider, model }` so both the provider id and the
   * provider-scoped model id round-trip together.
   *
   * When the persisted provider is no longer detected at mount time the UI
   * falls back to the default `{ claude-cli, sonnet }` and surfaces a one-time
   * toast (see AC-US1-05). The persisted value is intentionally not cleared
   * — it becomes usable again when the provider returns.
   */
  skillGenModel?: { provider: string; model: string };
  /**
   * 0686 US-002 / T-006 (UI): AgentScopePicker persists the user's active
   * agent here so the sidebar scope (INSTALLED / GLOBAL) binds to the same
   * agent across reloads. Strictly UI-only — the server still reads
   * `activeScopeAgent` out of `studio.json` via `saveStudioSelection`.
   * This key mirrors that value so the hydrate path can render the
   * trigger label without a round-trip.
   */
  activeAgent?: string;
  /** Additional opaque preference keys — callers can store anything
   *  JSON-serializable here. */
  [key: string]: unknown;
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the full preferences object. Returns an empty object on any failure.
 * Never throws.
 */
export function readStudioPreferences(): StudioPreferences {
  const ls = safeLocalStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(STUDIO_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as StudioPreferences;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist a single preference key without clobbering unrelated keys. Never
 * throws. Silently no-ops if storage is unavailable or throws mid-write.
 */
export function writeStudioPreference<K extends keyof StudioPreferences>(
  key: K,
  value: StudioPreferences[K],
): void {
  const ls = safeLocalStorage();
  if (!ls) return;
  try {
    const current = readStudioPreferences();
    const next = { ...current, [key]: value };
    ls.setItem(STUDIO_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded, access denied, etc. Callers continue with in-memory
    // state only.
  }
}

/**
 * Read a single preference with a default fallback. Convenience wrapper
 * around `readStudioPreferences()` for call sites that only care about one
 * key.
 */
export function getStudioPreference<T>(key: keyof StudioPreferences, fallback: T): T {
  const prefs = readStudioPreferences();
  const v = prefs[key];
  return v === undefined ? fallback : (v as unknown as T);
}
