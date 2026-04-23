/**
 * Pure helpers for theme resolution. No React, no DOM apart from the
 * element passed to applyTheme. Extracted so it can be unit-tested
 * independently from the React component tree.
 *
 * Related ADRs: 0674-01 (warm-neutral tokens), 0674-04 (Tailwind @theme home).
 */

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vskill-theme";
export const CONTRAST_STORAGE_KEY = "vskill-contrast";

export const VALID_MODES: readonly ThemeMode[] = ["auto", "light", "dark"];

/** Narrow an unknown value to ThemeMode, defaulting to 'auto'. */
export function coerceMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "auto"
    ? value
    : "auto";
}

/** Resolve the user-mode + system-dark signal into a concrete theme. */
export function resolveTheme(
  mode: ThemeMode,
  systemDark: boolean,
): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  return systemDark ? "dark" : "light";
}

/**
 * Read the stored theme mode. Returns 'auto' for missing / invalid / throwing
 * storage (private-browsing scenarios throw on getItem).
 */
export function readStoredTheme(storage: Storage): ThemeMode {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return coerceMode(raw);
  } catch {
    return "auto";
  }
}

/** Persist the theme mode; swallows storage exceptions. */
export function writeStoredTheme(storage: Storage, mode: ThemeMode): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore — private-browsing / quota exceeded */
  }
}

/**
 * Apply the resolved theme to an element (typically document.documentElement).
 * data-theme holds the concrete theme used for CSS overrides.
 * data-theme-mode holds the user's chosen mode ("auto" | "light" | "dark")
 * so components can render a toggle reflecting the user's intent.
 */
export function applyTheme(
  element: HTMLElement,
  mode: ThemeMode,
  resolved: ResolvedTheme,
): void {
  element.dataset.theme = resolved;
  element.dataset.themeMode = mode;
}

/**
 * Read the system dark-mode preference via matchMedia, safely.
 * Returns false when matchMedia is unavailable or throws.
 */
export function readSystemDark(
  mm: typeof window.matchMedia | undefined,
): boolean {
  if (!mm) return false;
  try {
    return mm("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}
