import { useCallback, useEffect, useRef, useState } from "react";
import {
  listenTauriEvent,
  normalizeUpdateInfo,
  type RawUpdateInfo,
  type UpdateInfo,
  useDesktopBridge,
} from "../preferences/lib/useDesktopBridge";

type Phase = "idle" | "installing" | "ready" | "error";

function staleForAutoCheck(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return true;
  const ts = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts >= 24 * 60 * 60 * 1000;
}

export function AppUpdateToast() {
  const bridge = useDesktopBridge();
  const currentVersionRef = useRef("unknown");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ bytes: number; total: number | null }>({
    bytes: 0,
    total: null,
  });
  const [error, setError] = useState<string | null>(null);

  const showUpdate = useCallback((raw: RawUpdateInfo) => {
    const info = normalizeUpdateInfo(raw, currentVersionRef.current);
    if (info.available && info.latestVersion) {
      setUpdate(info);
      setPhase((prev) => (prev === "ready" ? prev : "idle"));
      setError(null);
      return;
    }
    setUpdate(null);
    setPhase("idle");
  }, []);

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
      const [availableUnlisten, checkUnlisten, restartUnlisten] = await Promise.all([
        listenTauriEvent<RawUpdateInfo>("updater://available", (event) => {
          if (!cancelled) showUpdate(event.payload);
        }),
        listenTauriEvent<RawUpdateInfo>("updater://check-result", (event) => {
          if (!cancelled) showUpdate(event.payload);
        }),
        listenTauriEvent<{ version?: string }>("updater://restart-required", (event) => {
          if (cancelled) return;
          setPhase("ready");
          setUpdate((prev) =>
            prev ??
            normalizeUpdateInfo(
              { available: true, version: event.payload?.version ?? null },
              currentVersionRef.current,
            ),
          );
        }),
      ]);
      for (const fn of [availableUnlisten, checkUnlisten, restartUnlisten]) {
        if (fn) unlisteners.push(fn);
      }

      const settings = await bridge.getSettings().catch(() => null);
      if (!cancelled && settings?.updates.autoCheck && staleForAutoCheck(settings.updates.lastCheckedAt)) {
        const info = await bridge.checkForUpdates().catch(() => null);
        if (!cancelled && info?.available) setUpdate(info);
      }
    })();

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) void unlisten();
    };
  }, [bridge, showUpdate]);

  const install = useCallback(async () => {
    if (!update || phase === "installing") return;
    setPhase("installing");
    setError(null);
    setProgress({ bytes: 0, total: null });
    try {
      await bridge.downloadAndInstallUpdate((bytes, total) => {
        setProgress({ bytes, total });
      });
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bridge, phase, update]);

  const restart = useCallback(async () => {
    try {
      await bridge.restartApp();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bridge]);

  if (!update || dismissedVersion === update.latestVersion) return null;

  const pct =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.bytes / progress.total) * 100))
      : null;

  return (
    <div
      data-testid="app-update-toast"
      className="fixed bottom-20 right-4 z-50 flex max-w-[360px] flex-col gap-2 rounded-lg px-4 py-3 text-[13px] shadow-lg animate-fade-in"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--color-own)",
        color: "var(--text-primary)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Skill Studio {update.latestVersion} is available</div>
          <div className="mt-1 line-clamp-3 text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {phase === "ready"
              ? "Ready to restart and finish installing."
              : update.releaseNotes ?? "Update ready to install."}
          </div>
          {phase === "installing" ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--border-default)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: pct === null ? "35%" : `${pct}%`,
                  background: "var(--color-own)",
                }}
              />
            </div>
          ) : null}
          {phase === "error" && error ? (
            <div className="mt-1 text-[12px]" style={{ color: "var(--status-danger-text)" }}>
              {error}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss app update"
          onClick={() => setDismissedVersion(update.latestVersion ?? "unknown")}
          className="text-[14px] leading-none"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            cursor: "pointer",
            padding: "0 2px",
          }}
        >
          &#x2715;
        </button>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="px-2 py-1 text-[12px] font-semibold"
          style={{
            background: "transparent",
            border: "1px solid var(--border-default)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            cursor: "pointer",
          }}
          onClick={() => bridge.openPreferences("updates").catch(() => undefined)}
        >
          Details
        </button>
        <button
          type="button"
          data-testid={phase === "ready" ? "app-update-restart" : "app-update-install"}
          className="px-2 py-1 text-[12px] font-semibold"
          disabled={phase === "installing"}
          style={{
            background: "var(--color-own)",
            border: "1px solid var(--color-own)",
            borderRadius: 4,
            color: "var(--color-paper)",
            cursor: phase === "installing" ? "not-allowed" : "pointer",
          }}
          onClick={phase === "ready" ? restart : install}
        >
          {phase === "ready" ? "Restart now" : phase === "installing" ? "Installing..." : "Install"}
        </button>
      </div>
    </div>
  );
}
