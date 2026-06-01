import { useMemo } from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";

export function AppUpdateButton() {
  const updater = useAppUpdater();

  const label = useMemo(() => {
    if (updater.phase === "installing") return "Installing...";
    if (updater.phase === "restarting") return "Restarting...";
    if (updater.phase === "ready") return "Restart";
    if (updater.phase === "error") return "Update failed";
    return "Update";
  }, [updater.phase]);

  if (!updater.available && !(updater.update && updater.phase === "error")) return null;

  const disabled = updater.phase === "installing" || updater.phase === "restarting";
  const title = updater.error
    ? `Update failed: ${updater.error}`
    : updater.update?.latestVersion
      ? `Install Skill Studio ${updater.update.latestVersion} and restart`
      : "Install the latest Skill Studio update";

  return (
    <button
      type="button"
      data-testid="app-update-header-button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={() => {
        void updater.installAndRestart();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 28,
        minWidth: 76,
        padding: "0 12px",
        borderRadius: 999,
        border:
          updater.phase === "error"
            ? "1px solid var(--status-danger-text)"
            : "1px solid var(--color-own)",
        background:
          updater.phase === "error"
            ? "var(--bg-surface)"
            : disabled
              ? "var(--bg-muted)"
              : "var(--color-own)",
        color:
          updater.phase === "error"
            ? "var(--status-danger-text)"
            : disabled
              ? "var(--text-secondary)"
              : "var(--color-paper)",
        fontSize: 12,
        fontWeight: 700,
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "wait" : "pointer",
        whiteSpace: "nowrap",
        boxShadow:
          updater.phase === "error"
            ? "none"
            : "0 1px 2px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: "currentColor",
          opacity: updater.phase === "installing" || updater.phase === "restarting" ? 0.55 : 1,
        }}
      />
      {label}
    </button>
  );
}
