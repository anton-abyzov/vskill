// ---------------------------------------------------------------------------
// 0700 — PluginActionMenu
//
// Small "⋯" button + popover menu on each AVAILABLE > Plugins tree parent
// row. Lets users Enable / Disable / Uninstall a plugin directly from the
// sidebar without dropping to a terminal. Calls `claude plugin ...` via the
// new /api/plugins/:name/... endpoints.
//
// Menu contents adapt to the plugin's current state:
//   - enabled=true  → [Disable] [Uninstall]
//   - enabled=false → [Enable]  [Uninstall]
//
// 0767: Uninstall now routes through the shared <ConfirmDialog> instead of
// window.confirm(), and surfaces success/error through the studio:toast
// CustomEvent bridge so feedback survives the menu being closed.
// ---------------------------------------------------------------------------

import * as React from "react";
import { mutate as swrMutate } from "../hooks/useSWR";
import { triggerPluginsRefresh } from "../hooks/usePluginsPolling";
import { ConfirmDialog } from "./ConfirmDialog";

export interface PluginActionMenuProps {
  pluginName: string;
  /** Current enabled/disabled state — determines which action to show. */
  enabled: boolean;
  /** Fired on successful mutation so parents can refresh. */
  onAfterAction?: () => void;
}

type Severity = "success" | "error" | "info" | "warning";

function emitToast(message: string, severity: Severity): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("studio:toast", { detail: { message, severity } }),
  );
}

export function PluginActionMenu({
  pluginName,
  enabled,
  onAfterAction,
}: PluginActionMenuProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function callApi(action: "enable" | "disable" | "uninstall"): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/plugins/${encodeURIComponent(pluginName)}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fallback?: string;
      };
      if (!res.ok || !body.ok) {
        const msg = body.error ?? `${action} failed (${res.status})`;
        setError(msg);
        if (action === "uninstall") {
          emitToast(`Failed to uninstall ${pluginName}: ${msg}`, "error");
        }
        return;
      }
      if (action === "uninstall") {
        const note =
          body.fallback === "orphan-cache-removed"
            ? `Removed orphaned ${pluginName}`
            : `Uninstalled ${pluginName}`;
        emitToast(note, "success");
      }
      swrMutate("skills");
      triggerPluginsRefresh();
      onAfterAction?.();
      setOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      if (action === "uninstall") {
        emitToast(`Failed to uninstall ${pluginName}: ${msg}`, "error");
      }
    } finally {
      setBusy(null);
    }
  }

  function onUninstallClick(): void {
    setConfirmOpen(true);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label={`Manage ${pluginName}`}
        title={`Manage ${pluginName}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        data-vskill-plugin-action-trigger={pluginName}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          padding: 0,
          marginLeft: 4,
          border: "none",
          background: open ? "var(--surface-2, rgba(0,0,0,0.08))" : "transparent",
          color: "var(--text-tertiary)",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 14,
          lineHeight: 1,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--text-primary)";
          e.currentTarget.style.background = "var(--surface-2, rgba(0,0,0,0.06))";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-tertiary)";
          e.currentTarget.style.background = open
            ? "var(--surface-2, rgba(0,0,0,0.08))"
            : "transparent";
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            right: 0,
            minWidth: 160,
            background: "var(--color-paper, #fff)",
            border: "1px solid var(--border-default, rgba(0,0,0,0.12))",
            borderRadius: 6,
            boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08), 0 8px 14px -4px rgba(0,0,0,0.12)",
            padding: 4,
            zIndex: 30,
            fontFamily: "var(--font-sans)",
          }}
        >
          {enabled ? (
            <MenuItem
              onClick={() => void callApi("disable")}
              disabled={busy !== null}
              busy={busy === "disable"}
              label="Disable"
              hint="Keep installed, turn off"
            />
          ) : (
            <MenuItem
              onClick={() => void callApi("enable")}
              disabled={busy !== null}
              busy={busy === "enable"}
              label="Enable"
              hint="Activate plugin"
            />
          )}
          <MenuItem
            onClick={onUninstallClick}
            disabled={busy !== null}
            busy={busy === "uninstall"}
            label="Uninstall"
            hint="Remove plugin + skills"
            danger
          />
          {error && (
            <div
              style={{
                padding: "6px 8px",
                fontSize: 11,
                color: "var(--color-error, #b91c1c)",
                background: "color-mix(in oklch, var(--color-error, #b91c1c) 8%, transparent)",
                borderRadius: 4,
                marginTop: 4,
                lineHeight: 1.4,
                maxWidth: 240,
                wordBreak: "break-word",
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`Uninstall ${pluginName}?`}
        body={`This removes the ${pluginName} plugin and all of its skills. You can reinstall it later from the marketplace.`}
        confirmLabel="Uninstall"
        cancelLabel="Cancel"
        variant="destructive"
        onCancel={() => {
          setConfirmOpen(false);
          setOpen(false);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void callApi("uninstall");
        }}
      />
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  busy,
  label,
  hint,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  hint: string;
  danger?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      role="menuitem"
      style={{
        display: "block",
        width: "100%",
        padding: "6px 10px",
        textAlign: "left",
        border: "none",
        background: "transparent",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        color: danger ? "var(--color-error, #b91c1c)" : "var(--text-primary)",
        opacity: disabled && !busy ? 0.5 : 1,
        fontFamily: "inherit",
      }}
      onMouseEnter={(e) => {
        if (!disabled)
          e.currentTarget.style.background = "var(--surface-2, rgba(0,0,0,0.05))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500 }}>
        {busy ? `${label}…` : label}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{hint}</div>
    </button>
  );
}
