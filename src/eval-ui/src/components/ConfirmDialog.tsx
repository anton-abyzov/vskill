import { useEffect, useRef } from "react";

/**
 * ConfirmDialog (0722) — accessible confirmation dialog used by the skill
 * delete flow. Replaces ad-hoc `window.confirm()` calls.
 *
 * Behavior:
 *   - role="alertdialog" + aria-labelledby/aria-describedby
 *   - Default focus on Cancel (the safer choice)
 *   - Escape cancels
 *   - Click on overlay cancels
 *   - Returns focus to the previously-focused element on close
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "destructive" tints the confirm button; "default" uses neutral. */
  variant?: "destructive" | "default";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    // Default focus → Cancel.
    requestAnimationFrame(() => {
      cancelRef.current?.focus();
    });
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      // Simple focus trap — Tab cycles between Cancel and Confirm.
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  const titleId = "confirm-dialog-title";
  const bodyId = "confirm-dialog-body";
  const confirmTint =
    variant === "destructive"
      ? { background: "var(--red, #d92d20)", color: "#fff", border: "1px solid var(--red, #d92d20)" }
      : { background: "var(--accent-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" };

  return (
    <div
      data-testid="confirm-dialog-overlay"
      onMouseDown={(e) => {
        // Only cancel when click started on the overlay itself, not on the dialog content.
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="confirm-dialog"
        style={{
          background: "var(--bg-canvas)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          padding: 20,
          width: "min(440px, 92vw)",
          boxShadow: "0 20px 48px rgba(0,0,0,0.32)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <h2
          id={titleId}
          style={{ margin: 0, fontSize: 16, fontWeight: 600, marginBottom: 8 }}
        >
          {title}
        </h2>
        <p
          id={bodyId}
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--text-secondary)",
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {body}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            ref={cancelRef}
            type="button"
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              cursor: "pointer",
              background: "transparent",
              color: "var(--text-primary)",
              border: "1px solid var(--border-default)",
              fontSize: 13,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 13,
              ...confirmTint,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Returns the platform-appropriate label for the OS trash, used in dialog
 * body text. Falls back to "Trash" when the platform is unknown.
 */
export function getTrashLabel(platform?: string): string {
  const p = (platform ?? (typeof navigator !== "undefined" ? navigator.platform : "")).toLowerCase();
  if (p.includes("mac")) return "system Trash";
  if (p.includes("win")) return "Recycle Bin";
  return "Trash";
}
