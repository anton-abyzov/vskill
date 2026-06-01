import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  listenTauriEvent,
  normalizeUpdateInfo,
  type RawUpdateInfo,
  type SettingsSnapshot,
  type UpdateInfo,
  useDesktopBridge,
} from "../preferences/lib/useDesktopBridge";

export type AppUpdatePhase =
  | "idle"
  | "checking"
  | "installing"
  | "ready"
  | "restarting"
  | "error";

interface AppUpdateProgress {
  bytes: number;
  total: number | null;
}

interface AppUpdaterContextValue {
  update: UpdateInfo | null;
  phase: AppUpdatePhase;
  progress: AppUpdateProgress;
  error: string | null;
  /** An update exists and is not suppressed — drives the compact TopRail pill. */
  available: boolean;
  /** The big top banner has been dismissed for the current version. */
  bannerDismissed: boolean;
  /** Whether the big top banner should render (available && not banner-dismissed). */
  bannerVisible: boolean;
  /** Hide the big banner for the current version (the pill stays). */
  dismiss: () => void;
  checkNow: () => Promise<UpdateInfo | null>;
  install: () => Promise<boolean>;
  restart: () => Promise<boolean>;
  installAndRestart: () => Promise<void>;
  openDetails: () => Promise<void>;
}

const AppUpdaterContext = createContext<AppUpdaterContextValue | null>(null);

// Foreground re-check cadence. The Rust auto-check loop only fires every 24h
// (gated on last_checked_at), so a continuously-running app would otherwise miss
// a freshly published release for up to a day. We re-check on focus/visibility
// and on an hourly interval, throttled so focus churn can't spam the endpoint.
const MIN_RECHECK_MS = 30 * 60 * 1000; // 30 min minimum spacing between checks
const FOREGROUND_POLL_MS = 60 * 60 * 1000; // hourly while the app is open

function isUpdateSuppressed(
  settings: SettingsSnapshot | null,
  latestVersion: string | undefined,
): boolean {
  if (!settings || !latestVersion) return false;
  if (settings.updates.skippedVersion === latestVersion) return true;
  if (!settings.updates.snoozedUntil) return false;
  const snoozedUntil = new Date(settings.updates.snoozedUntil).getTime();
  return !Number.isNaN(snoozedUntil) && snoozedUntil > Date.now();
}

export function AppUpdaterProvider({ children }: { children: ReactNode }) {
  const bridge = useDesktopBridge();
  const currentVersionRef = useRef("unknown");
  const lastCheckAtRef = useRef(0);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<AppUpdateProgress>({
    bytes: 0,
    total: null,
  });
  const [error, setError] = useState<string | null>(null);

  const applyUpdate = useCallback(
    (info: UpdateInfo, settings: SettingsSnapshot | null = null) => {
      if (
        info.available &&
        info.latestVersion &&
        !isUpdateSuppressed(settings, info.latestVersion)
      ) {
        setUpdate(info);
        setPhase((prev) => (prev === "ready" || prev === "restarting" ? prev : "idle"));
        setError(null);
        return info;
      }
      setUpdate(null);
      setPhase("idle");
      setError(null);
      return null;
    },
    [],
  );

  const applyRawUpdate = useCallback(
    (raw: RawUpdateInfo, settings: SettingsSnapshot | null = null) =>
      applyUpdate(normalizeUpdateInfo(raw, currentVersionRef.current), settings),
    [applyUpdate],
  );

  const checkNow = useCallback(async () => {
    if (!bridge.available) return null;
    setPhase((prev) => (prev === "installing" || prev === "restarting" ? prev : "checking"));
    setError(null);
    try {
      const [settings, info] = await Promise.all([
        bridge.getSettings().catch(() => null),
        bridge.checkForUpdates(),
      ]);
      // Stamp only after a successful check so a failed (e.g. offline) check can
      // retry on the next focus without waiting out the throttle window.
      lastCheckAtRef.current = Date.now();
      return applyUpdate(info, settings);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase("error");
      setError(message);
      return null;
    }
  }, [applyUpdate, bridge]);

  // Throttled re-check used by focus/visibility/interval triggers.
  const maybeCheck = useCallback(() => {
    if (!bridge.available) return;
    if (Date.now() - lastCheckAtRef.current < MIN_RECHECK_MS) return;
    void checkNow();
  }, [bridge.available, checkNow]);

  useEffect(() => {
    if (!bridge.available) return;
    let cancelled = false;
    const unlisteners: Array<() => void | Promise<void>> = [];

    void bridge
      .getAppMetadata()
      .then((metadata) => {
        currentVersionRef.current = metadata.version;
      })
      .catch(() => undefined);

    void (async () => {
      const [availableUnlisten, checkUnlisten, restartUnlisten, errorUnlisten] =
        await Promise.all([
          listenTauriEvent<RawUpdateInfo>("updater://available", (event) => {
            if (!cancelled) applyRawUpdate(event.payload);
          }),
          listenTauriEvent<RawUpdateInfo>("updater://check-result", (event) => {
            if (!cancelled) applyRawUpdate(event.payload);
          }),
          listenTauriEvent<{ version?: string; notes?: string | null }>(
            "updater://restart-required",
            (event) => {
              if (cancelled) return;
              setPhase("ready");
              setUpdate((prev) =>
                prev ??
                normalizeUpdateInfo(
                  {
                    available: true,
                    version: event.payload?.version ?? null,
                    notes: event.payload?.notes ?? null,
                  },
                  currentVersionRef.current,
                ),
              );
            },
          ),
          listenTauriEvent<{ message?: string }>("updater://error", (event) => {
            if (cancelled) return;
            setPhase("error");
            setError(event.payload?.message ?? "Update failed.");
          }),
        ]);
      for (const fn of [availableUnlisten, checkUnlisten, restartUnlisten, errorUnlisten]) {
        if (fn) unlisteners.push(fn);
      }

      const settings = await bridge.getSettings().catch(() => null);
      if (!cancelled && (settings?.updates.autoCheck ?? true)) {
        await checkNow();
      }
    })();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) void unlisten();
    };
  }, [applyRawUpdate, bridge, checkNow]);

  // Foreground re-check: focus, tab-visible, and an hourly poll. This is what
  // makes a freshly published release surface within minutes instead of after
  // the Rust 24h gate.
  useEffect(() => {
    if (!bridge.available) return;
    const onFocus = () => maybeCheck();
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeCheck();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const intervalId = setInterval(() => maybeCheck(), FOREGROUND_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(intervalId);
    };
  }, [bridge.available, maybeCheck]);

  const install = useCallback(async () => {
    if (!update || phase === "installing" || phase === "restarting") return false;
    setPhase("installing");
    setError(null);
    setProgress({ bytes: 0, total: null });
    try {
      await bridge.downloadAndInstallUpdate((bytes, total) => {
        setProgress({ bytes, total });
      });
      setPhase("ready");
      return true;
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [bridge, phase, update]);

  const restart = useCallback(async () => {
    if (phase === "restarting") return false;
    setPhase("restarting");
    setError(null);
    try {
      await bridge.restartApp();
      return true;
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [bridge, phase]);

  const installAndRestart = useCallback(async () => {
    if (!update || phase === "installing" || phase === "restarting") return;
    if (phase === "ready") {
      await restart();
      return;
    }
    const installed = await install();
    if (installed) await restart();
  }, [install, phase, restart, update]);

  const dismiss = useCallback(() => {
    setDismissedVersion(update?.latestVersion ?? "unknown");
  }, [update]);

  const openDetails = useCallback(
    () => bridge.openPreferences("updates").catch(() => undefined),
    [bridge],
  );

  const value = useMemo<AppUpdaterContextValue>(() => {
    const available = Boolean(update);
    const bannerDismissed =
      update?.latestVersion != null && dismissedVersion === update.latestVersion;
    return {
      update,
      phase,
      progress,
      error,
      available,
      bannerDismissed,
      bannerVisible: available && !bannerDismissed,
      dismiss,
      checkNow,
      install,
      restart,
      installAndRestart,
      openDetails,
    };
  }, [
    update,
    dismissedVersion,
    phase,
    progress,
    error,
    dismiss,
    checkNow,
    install,
    restart,
    installAndRestart,
    openDetails,
  ]);

  return <AppUpdaterContext.Provider value={value}>{children}</AppUpdaterContext.Provider>;
}

export function useAppUpdater(): AppUpdaterContextValue {
  const value = useContext(AppUpdaterContext);
  if (!value) {
    throw new Error("useAppUpdater must be used inside AppUpdaterProvider");
  }
  return value;
}
