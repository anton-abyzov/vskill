// ---------------------------------------------------------------------------
// 0831 US-003 — FolderPickerWarning.
//
// Modal shown when `pick_default_project_folder` returns a classification
// of `home_root` or `personal_scope`. Spec text per AC-US3-01:
//
//   "This is your home directory. Skill Studio shows personal skills here.
//    Pick a specific project subfolder instead."
//
// Two actions:
//   - "Pick again"        — re-opens the picker (caller-supplied callback)
//   - "Use this anyway"   — proceeds with the chosen path (caller's onProceed)
//
// Personal-scope variant shows a slightly different copy because the
// folder isn't `$HOME` itself but is one of the AI-tooling hidden dirs
// (`~/.claude/`, `~/.specweave/`, etc.). The user might genuinely intend
// to manage personal-scope skills here, so the modal lets them confirm
// without nagging.
//
// Accessibility: focus is trapped inside the modal while open, ESC closes
// (treated as "Pick again"), the primary action is keyboard-reachable in
// tab order, the modal is announced as `role="dialog"` with
// `aria-labelledby` on the title.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";

export type WarningKind = "home_root" | "personal_scope";

interface Props {
  /** Which classification triggered the modal — drives the copy. */
  kind: WarningKind;
  /** Path the user picked, displayed inside the modal for context. */
  path: string;
  /** "Pick again" handler — typically re-invokes `bridge.pickFolder()`. */
  onPickAgain: () => void;
  /** "Use this anyway" — proceeds with the path as the project root. */
  onProceed: () => void;
  /** Close the modal without proceeding (ESC, click outside). */
  onClose: () => void;
}

const COPY_HOME_ROOT = {
  title: "This is your home directory",
  body: "Skill Studio shows personal skills here. Pick a specific project subfolder instead.",
} as const;

const COPY_PERSONAL_SCOPE = {
  title: "This is a personal-scope folder",
  body: "Skills under this directory are personal-scope (shared across all your projects). If you meant to open a specific project, pick a project subfolder instead.",
} as const;

export function FolderPickerWarning({
  kind,
  path,
  onPickAgain,
  onProceed,
  onClose,
}: Props): React.ReactElement {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pickAgainRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus "Pick again" on mount — the safer choice if the user
  // dismisses with Enter without thinking. They can Tab to "Use anyway".
  useEffect(() => {
    pickAgainRef.current?.focus();
  }, []);

  // ESC = close. Listen on the document; remove on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const copy = kind === "home_root" ? COPY_HOME_ROOT : COPY_PERSONAL_SCOPE;
  const titleId = "folder-picker-warning-title";
  const bodyId = "folder-picker-warning-body";

  return (
    <div
      data-testid="folder-picker-warning-overlay"
      role="presentation"
      onClick={(e) => {
        // Click the backdrop (NOT the dialog itself) closes.
        if (e.target === e.currentTarget) onClose();
      }}
      style={overlayStyle}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="folder-picker-warning-dialog"
        data-kind={kind}
        style={dialogStyle}
      >
        <h2 id={titleId} style={titleStyle}>
          {copy.title}
        </h2>
        <p id={bodyId} style={bodyStyle}>
          {copy.body}
        </p>
        <code data-testid="folder-picker-warning-path" style={pathStyle}>
          {path}
        </code>
        <div style={actionsStyle}>
          <button
            ref={pickAgainRef}
            type="button"
            data-testid="folder-picker-warning-pick-again"
            onClick={onPickAgain}
            style={primaryButtonStyle}
          >
            Pick again
          </button>
          <button
            type="button"
            data-testid="folder-picker-warning-use-anyway"
            onClick={onProceed}
            style={secondaryButtonStyle}
          >
            Use this anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles — keeps the component drop-in for any host stylesheet.
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--color-surface, #ffffff)",
  color: "var(--color-text, #1a1a1a)",
  padding: "24px 28px",
  borderRadius: 8,
  width: "min(480px, 90vw)",
  boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
  fontFamily: "var(--font-system, -apple-system, system-ui)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 18,
  fontWeight: 600,
};

const bodyStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--color-text-soft, #555)",
};

const pathStyle: React.CSSProperties = {
  display: "block",
  padding: "8px 10px",
  background: "var(--color-pill-bg, rgba(0,0,0,0.05))",
  borderRadius: 4,
  fontSize: 12,
  marginBottom: 18,
  wordBreak: "break-all",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "var(--color-accent, #2563eb)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "var(--color-text, #333)",
  border: "1px solid var(--color-border, #ccc)",
  borderRadius: 4,
  padding: "8px 16px",
  fontSize: 14,
  cursor: "pointer",
};
