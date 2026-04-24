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
// Optimistic UI: the caller passes `onAfterAction` which triggers a refetch
// of both /api/plugins (for enabled-state) and /api/skills (so the sidebar
// reflects the new available skills).
// ---------------------------------------------------------------------------

import * as React from "react";
import { mutate as swrMutate } from "../hooks/useSWR";

export interface PluginActionMenuProps {
  pluginName: string;
  /** Current enabled/disabled state — determines which action to show. */
  enabled: boolean;
  /** Fired on successful mutation so parents can refresh. */
  onAfterAction?: () => void;
}

export function PluginActionMenu({
  pluginName,
  enabled,
  onAfterAction,
}: PluginActionMenuProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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

  async function runAction(
    action: "enable" | "disable" | "uninstall",
  ): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      if (action === "uninstall") {
        if (!window.confirm(`Uninstall ${pluginName}? This removes the plugin and its skills.`)) {
          setBusy(null);
          return;
        }
      }
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
      };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `${action} failed (${res.status})`);
        return;
      }
      swrMutate("skills");
      swrMutate("plugins");
      onAfterAction?.();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
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
              onClick={() => void runAction("disable")}
              disabled={busy !== null}
              busy={busy === "disable"}
              label="Disable"
              hint="Keep installed, turn off"
            />
          ) : (
            <MenuItem
              onClick={() => void runAction("enable")}
              disabled={busy !== null}
              busy={busy === "enable"}
              label="Enable"
              hint="Activate plugin"
            />
          )}
          <MenuItem
            onClick={() => void runAction("uninstall")}
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
