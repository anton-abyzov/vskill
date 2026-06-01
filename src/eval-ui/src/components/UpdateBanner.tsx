import { useAppUpdater } from "../hooks/useAppUpdater";

/**
 * Full-width "a newer Skill Studio is available" banner, rendered above the top
 * rail via StudioLayout's `banner` slot. This is the prominent desktop
 * self-update surface; the TopRail pill (AppUpdateButton) is the compact
 * fallback that remains after this banner is dismissed.
 *
 * Desktop-only: useAppUpdater gates on the Tauri bridge, so in browser studio
 * (`npx vskill studio`) `bannerVisible` is never true and this renders nothing.
 */
export function UpdateBanner() {
  const updater = useAppUpdater();
  const { update, phase, progress, error } = updater;

  if (!updater.bannerVisible || !update) return null;

  const pct =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.bytes / progress.total) * 100))
      : null;

  const installing = phase === "installing";
  const restarting = phase === "restarting";
  const ready = phase === "ready";
  const busy = installing || restarting;

  const primaryLabel = ready
    ? "Restart now"
    : restarting
      ? "Restarting…"
      : installing
        ? pct === null
          ? "Installing…"
          : `Installing… ${pct}%`
        : "Update now";

  return (
    <aside
      data-testid="app-update-banner"
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px",
        background: "color-mix(in srgb, var(--color-own) 14%, var(--bg-surface))",
        borderBottom: "1px solid var(--color-own)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
    >
      <span
        data-testid="app-update-banner-badge"
        aria-hidden="true"
        style={{
          flexShrink: 0,
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 700,
          background: "var(--color-own)",
          color: "var(--color-paper)",
        }}
      >
        Update
      </span>

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 600 }}>
          {ready
            ? `Skill Studio ${update.latestVersion} is ready to install`
            : `Skill Studio ${update.latestVersion} is available`}
        </span>
        {phase === "error" && error ? (
          <span
            data-testid="app-update-banner-error"
            style={{ color: "var(--status-danger-text)", fontSize: 12 }}
          >
            {error}
          </span>
        ) : update.releaseNotes ? (
          <span
            style={{
              color: "var(--text-secondary)",
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "60ch",
            }}
          >
            {update.releaseNotes}
          </span>
        ) : null}
      </div>

      {installing ? (
        <div
          aria-hidden="true"
          style={{
            width: 120,
            height: 6,
            borderRadius: 999,
            overflow: "hidden",
            background: "var(--border-default)",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              height: "100%",
              width: pct === null ? "35%" : `${pct}%`,
              background: "var(--color-own)",
            }}
          />
        </div>
      ) : null}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        data-testid="app-update-banner-action"
        disabled={busy}
        onClick={() => {
          void updater.installAndRestart();
        }}
        style={{
          flexShrink: 0,
          background: busy ? "var(--bg-muted)" : "var(--color-own)",
          color: busy ? "var(--text-secondary)" : "var(--color-paper)",
          border: "1px solid var(--color-own)",
          borderRadius: 6,
          padding: "5px 14px",
          fontSize: 12,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: busy ? "wait" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {primaryLabel}
      </button>

      <button
        type="button"
        data-testid="app-update-banner-dismiss"
        aria-label="Dismiss update banner"
        onClick={updater.dismiss}
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          color: "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 15,
          lineHeight: 1,
          padding: "0 2px",
        }}
      >
        &#x2715;
      </button>
    </aside>
  );
}
