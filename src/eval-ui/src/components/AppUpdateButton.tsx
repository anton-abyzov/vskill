import { useMemo } from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";

/**
 * Highlighted "update available" chip that lives in the top rail, right next to
 * the project picker — the one place a developer's eye returns to. It is the
 * sole desktop self-update affordance (there is no separate full-width banner):
 * invisible until an update exists, then a glowing amber chip that can't be
 * missed. One click downloads, installs, and restarts. Desktop-only — gated by
 * useAppUpdater's Tauri bridge, so it never renders in browser studio.
 */
export function AppUpdateButton() {
  const updater = useAppUpdater();
  const { phase, progress } = updater;

  const pct =
    progress.total && progress.total > 0
      ? Math.min(100, Math.round((progress.bytes / progress.total) * 100))
      : null;

  const label = useMemo(() => {
    if (phase === "installing") return pct === null ? "Installing…" : `Installing… ${pct}%`;
    if (phase === "restarting") return "Restarting…";
    if (phase === "ready") return "Restart to update";
    if (phase === "error") return "Update failed";
    return "Update available";
  }, [phase, pct]);

  // Render only when an update is in play (available) or a prior attempt errored.
  if (!updater.available && !(updater.update && phase === "error")) return null;

  const disabled = phase === "installing" || phase === "restarting";
  const isError = phase === "error";
  const version = updater.update?.latestVersion;
  const title = updater.error
    ? `Update failed: ${updater.error}`
    : version
      ? `Install Skill Studio ${version} and restart`
      : "Install the latest Skill Studio update";

  return (
    <button
      type="button"
      data-testid="app-update-header-button"
      data-update-available={!isError ? "true" : undefined}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={() => {
        void updater.installAndRestart();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 28,
        padding: "0 12px",
        borderRadius: 999,
        border: isError
          ? "1px solid var(--status-danger-text)"
          : "1px solid var(--color-own)",
        background: isError
          ? "var(--bg-surface)"
          : disabled
            ? "var(--bg-muted)"
            : "var(--color-own)",
        color: isError
          ? "var(--status-danger-text)"
          : disabled
            ? "var(--text-secondary)"
            : "var(--color-paper)",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "wait" : "pointer",
        whiteSpace: "nowrap",
        // The highlight: a soft amber halo so the chip reads as "new / act on me"
        // against the neutral top rail. Static (no shimmer) to respect lint.
        boxShadow: isError
          ? "none"
          : "0 0 0 3px color-mix(in srgb, var(--color-own) 22%, transparent), 0 1px 2px rgba(0,0,0,0.18)",
      }}
    >
      {/* leading up-arrow glyph in a tinted dot */}
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 15,
          height: 15,
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 900,
          lineHeight: 1,
          background: isError
            ? "transparent"
            : "color-mix(in srgb, var(--color-paper) 28%, transparent)",
          color: "currentColor",
        }}
      >
        ↑
      </span>
      {label}
    </button>
  );
}
