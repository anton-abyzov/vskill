import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  coerceMode,
  readStoredTheme,
  readSystemDark,
  resolveTheme,
  THEME_STORAGE_KEY,
  writeStoredTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-utils";

export interface ThemeContextValue {
  /** The user-chosen mode: "auto" | "light" | "dark". */
  mode: ThemeMode;
  /** The concrete theme applied to the DOM ("light" | "dark"). */
  resolvedTheme: ResolvedTheme;
  /** Set the user-chosen mode; persists to localStorage. */
  setTheme: (mode: ThemeMode) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Override the storage (tests). Defaults to window.localStorage. */
  storage?: Storage;
  /** Override matchMedia (tests). Defaults to window.matchMedia. */
  matchMedia?: typeof window.matchMedia;
  /** Element to mutate (tests). Defaults to document.documentElement. */
  target?: HTMLElement;
  children?: ReactNode;
}

/**
 * Custom Vite-SPA theme provider (no next-themes). Responsibilities:
 *
 * - Initial mode is read from localStorage (or "auto" if unset).
 * - Resolved theme = mode, except "auto" follows prefers-color-scheme.
 * - Writes data-theme + data-theme-mode on the target element.
 * - Subscribes to "change" on matchMedia for auto-follow updates.
 * - Subscribes to "storage" on window to sync across browser tabs.
 *
 * ADR: 0674-01 (tokens), 0674-04 (Tailwind @theme home).
 */
export function ThemeProvider({
  storage,
  matchMedia,
  target,
  children,
}: ThemeProviderProps) {
  const storageRef = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  const mmRef = matchMedia ?? (typeof window !== "undefined" ? window.matchMedia.bind(window) : undefined);
  const targetRef =
    target ?? (typeof document !== "undefined" ? document.documentElement : undefined);

  const [mode, setMode] = useState<ThemeMode>(() => {
    if (!storageRef) return "auto";
    return readStoredTheme(storageRef);
  });

  const [systemDark, setSystemDark] = useState<boolean>(() =>
    readSystemDark(mmRef),
  );

  const resolvedTheme: ResolvedTheme = useMemo(
    () => resolveTheme(mode, systemDark),
    [mode, systemDark],
  );

  // Apply theme to DOM on every state change.
  useEffect(() => {
    if (!targetRef) return;
    applyTheme(targetRef, mode, resolvedTheme);
  }, [targetRef, mode, resolvedTheme]);

  // Follow prefers-color-scheme while mode === "auto".
  useEffect(() => {
    if (!mmRef) return;
    const mql = mmRef("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    // addEventListener is the modern API; some older engines only have
    // addListener. Prefer the modern one since we target current browsers.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Fallback for very old engines (not expected in target environments).
    const legacy = mql as unknown as {
      addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener(onChange);
    return () => legacy.removeListener(onChange);
  }, [mmRef]);

  // Cross-tab sync: update when another tab writes the same key.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setMode(coerceMode(event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // T-046: prefers-contrast: more glue. The inline FOUC script in index.html
  // sets data-contrast="more" on first paint; this effect keeps it in sync
  // if the OS-level preference toggles while the app is running.
  useEffect(() => {
    if (!mmRef || !targetRef) return;
    let mql: MediaQueryList;
    try {
      mql = mmRef("(prefers-contrast: more)");
    } catch {
      return;
    }
    const apply = (matches: boolean) => {
      if (matches) {
        targetRef.dataset.contrast = "more";
      } else if (targetRef.dataset.contrast === "more") {
        delete targetRef.dataset.contrast;
      }
    };
    apply(mql.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    const legacy = mql as unknown as {
      addListener: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener(onChange);
    return () => legacy.removeListener(onChange);
  }, [mmRef, targetRef]);

  const setTheme = useCallback(
    (next: ThemeMode) => {
      setMode(next);
      if (storageRef) {
        writeStoredTheme(storageRef, next);
      }
    },
    [storageRef],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedTheme, setTheme }),
    [mode, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
