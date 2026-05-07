import { useCallback, useEffect, useMemo, useState } from "react";

export type BridgeMode = "desktop" | "browser";

export class BrowserModeError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available in browser mode — install the Skill Studio desktop app.`);
    this.name = "BrowserModeError";
  }
}

export interface SettingsSnapshot {
  version: number;
  general: {
    theme: "system" | "light" | "dark";
    language: string;
    defaultProjectFolder: string | null;
    launchAtLogin: boolean;
  };
  updates: {
    channel: "stable" | "beta";
    autoCheck: boolean;
    lastCheckedAt: string | null;
    lastKnownVersion: string | null;
    skippedVersion: string | null;
    snoozedUntil: string | null;
  };
  privacy: {
    telemetryEnabled: boolean;
    crashReportingEnabled: boolean;
  };
  advanced: {
    logLevel: "error" | "warn" | "info" | "debug" | "trace";
  };
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseNotes?: string;
  releaseDate?: string;
}

export interface AppMetadata {
  version: string;
  build: string;
  commit: string;
  target: string;
  arch: string;
}

export interface DesktopBridge {
  mode: BridgeMode;
  available: boolean;
  getSettings: () => Promise<SettingsSnapshot>;
  setSetting: (path: string, value: unknown) => Promise<void>;
  resetSettings: () => Promise<void>;
  checkForUpdates: () => Promise<UpdateInfo>;
  downloadAndInstallUpdate: (
    onProgress?: (chunk: number, total: number | null) => void,
  ) => Promise<void>;
  cancelUpdate: () => Promise<void>;
  openPreferences: (tab?: string) => Promise<void>;
  getAppMetadata: () => Promise<AppMetadata>;
  setAutostart: (enabled: boolean) => Promise<void>;
  pickFolder: () => Promise<string | null>;
  openLogsFolder: () => Promise<void>;
  revealSettingsFile: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
}

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals;
}

function detectMode(): BridgeMode {
  if (typeof window === "undefined") return "browser";
  return "__TAURI_INTERNALS__" in window ? "desktop" : "browser";
}

const BROWSER_DEFAULTS: SettingsSnapshot = {
  version: 1,
  general: {
    theme: "system",
    language: "auto",
    defaultProjectFolder: null,
    launchAtLogin: false,
  },
  updates: {
    channel: "stable",
    autoCheck: true,
    lastCheckedAt: null,
    lastKnownVersion: null,
    skippedVersion: null,
    snoozedUntil: null,
  },
  privacy: {
    telemetryEnabled: false,
    crashReportingEnabled: false,
  },
  advanced: {
    logLevel: "info",
  },
};

const BROWSER_STORAGE_KEY = "vskill:preferences:browser-shadow";

function loadBrowserShadow(): SettingsSnapshot {
  try {
    const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
    if (!raw) return structuredClone(BROWSER_DEFAULTS);
    const parsed = JSON.parse(raw) as Partial<SettingsSnapshot>;
    return { ...BROWSER_DEFAULTS, ...parsed } as SettingsSnapshot;
  } catch {
    return structuredClone(BROWSER_DEFAULTS);
  }
}

function saveBrowserShadow(snapshot: SettingsSnapshot): void {
  try {
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* private browsing — silent */
  }
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const w = window as TauriWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new BrowserModeError(cmd);
  return invoke(cmd, args) as Promise<T>;
}

export function useDesktopBridge(): DesktopBridge {
  const [mode] = useState<BridgeMode>(() => detectMode());

  const bridge = useMemo<DesktopBridge>(() => {
    const available = mode === "desktop";

    const getSettings: DesktopBridge["getSettings"] = async () => {
      if (!available) return loadBrowserShadow();
      return tauriInvoke<SettingsSnapshot>("get_settings");
    };

    const setSetting: DesktopBridge["setSetting"] = async (path, value) => {
      if (!available) {
        const snapshot = loadBrowserShadow();
        setNested(snapshot as unknown as Record<string, unknown>, path, value);
        saveBrowserShadow(snapshot);
        window.dispatchEvent(
          new CustomEvent("preferences-shadow-updated", { detail: { path, value } }),
        );
        return;
      }
      // Rust handler signature: `set_setting(key: String, value: Value)`.
      // The Tauri IPC bridge serializes args by parameter NAME — sending
      // `{ path }` instead of `{ key }` makes the call fail deserialization
      // silently in v1.0.12 and the snapshot never refreshes.
      await tauriInvoke<void>("set_setting", { key: path, value });
    };

    const resetSettings: DesktopBridge["resetSettings"] = async () => {
      if (!available) {
        try {
          localStorage.removeItem(BROWSER_STORAGE_KEY);
        } catch {
          /* private browsing — silent */
        }
        window.dispatchEvent(new CustomEvent("preferences-shadow-reset"));
        return;
      }
      await tauriInvoke<void>("reset_settings");
    };

    const checkForUpdates: DesktopBridge["checkForUpdates"] = async () => {
      if (!available) throw new BrowserModeError("checkForUpdates");
      return tauriInvoke<UpdateInfo>("check_for_updates");
    };

    const downloadAndInstallUpdate: DesktopBridge["downloadAndInstallUpdate"] = async () => {
      if (!available) throw new BrowserModeError("downloadAndInstallUpdate");
      await tauriInvoke<void>("download_and_install_update");
    };

    const cancelUpdate: DesktopBridge["cancelUpdate"] = async () => {
      if (!available) throw new BrowserModeError("cancelUpdate");
      await tauriInvoke<void>("cancel_update");
    };

    const openPreferences: DesktopBridge["openPreferences"] = async (tab) => {
      if (!available) {
        if (tab) window.location.hash = `#${tab}`;
        return;
      }
      await tauriInvoke<void>("open_preferences", { tab: tab ?? null });
    };

    const getAppMetadata: DesktopBridge["getAppMetadata"] = async () => {
      if (!available) {
        return {
          version: "browser",
          build: "n/a",
          commit: "n/a",
          target: navigator.platform || "browser",
          arch: "n/a",
        };
      }
      return tauriInvoke<AppMetadata>("get_app_metadata");
    };

    const setAutostart: DesktopBridge["setAutostart"] = async (enabled) => {
      if (!available) throw new BrowserModeError("setAutostart");
      await tauriInvoke<void>("set_autostart", { enabled });
    };

    const pickFolder: DesktopBridge["pickFolder"] = async () => {
      if (!available) throw new BrowserModeError("pickFolder");
      return tauriInvoke<string | null>("pick_default_project_folder");
    };

    const openLogsFolder: DesktopBridge["openLogsFolder"] = async () => {
      if (!available) throw new BrowserModeError("openLogsFolder");
      await tauriInvoke<void>("open_logs_folder");
    };

    const revealSettingsFile: DesktopBridge["revealSettingsFile"] = async () => {
      if (!available) throw new BrowserModeError("revealSettingsFile");
      await tauriInvoke<void>("reveal_settings_file");
    };

    const copyToClipboard: DesktopBridge["copyToClipboard"] = async (text) => {
      // No `copy_settings_path` Rust handler exists, and the clipboard plugin
      // is not enabled in src-tauri/Cargo.toml. The web Clipboard API works
      // inside the Tauri 2 webview and in the browser, so use it everywhere.
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* clipboard denied — silent; UI shows generic toast */
      }
    };

    return {
      mode,
      available,
      getSettings,
      setSetting,
      resetSettings,
      checkForUpdates,
      downloadAndInstallUpdate,
      cancelUpdate,
      openPreferences,
      getAppMetadata,
      setAutostart,
      pickFolder,
      openLogsFolder,
      revealSettingsFile,
      copyToClipboard,
    };
  }, [mode]);

  return bridge;
}

export function useSettingsSnapshot(bridge: DesktopBridge) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await bridge.getSettings();
      setSnapshot(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await bridge.getSettings();
        if (!cancelled) {
          setSnapshot(next);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener("preferences-shadow-updated", handler);
    window.addEventListener("preferences-shadow-reset", handler);
    return () => {
      window.removeEventListener("preferences-shadow-updated", handler);
      window.removeEventListener("preferences-shadow-reset", handler);
    };
  }, [refresh]);

  return { snapshot, error, loading, refresh };
}
