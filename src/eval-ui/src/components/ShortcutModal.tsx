import { useEffect, useRef } from "react";
import { strings } from "../strings";

/**
 * Keyboard cheatsheet modal (T-040).
 *
 * Contract:
 *   - Opens when the parent sets `open=true`; closes when `open=false`.
 *   - The caller owns the `?` trigger — typically wired via `useKeyboardShortcut`.
 *   - `Escape` closes, returning focus to the element that had focus at open.
 *   - `role="dialog"` + `aria-modal="true"` + `aria-labelledby` bind the title.
 *   - Focus is captured by the close button on open; Tab/Shift+Tab cycle
 *     inside (currently just the close button — if more interactive
 *     elements are added later, the trap naturally expands).
 *   - No portal — rendered inline in a fixed-position overlay so theme
 *     tokens inherit without prop-drilling.
 */

export interface ShortcutRow {
  keys: string;
  label: string;
}

export interface ShortcutGroup {
  name: string;
  items: ShortcutRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  groups?: ShortcutGroup[];
  /** Override the title (defaults to "Keyboard shortcuts"). */
  title?: string;
}

export const DEFAULT_GROUPS: ShortcutGroup[] = [
  {
    name: strings.shortcuts.groupNavigation,
    items: [
      { keys: "/", label: strings.shortcuts.search },
      { keys: "j", label: strings.shortcuts.moveDown },
      { keys: "k", label: strings.shortcuts.moveUp },
      { keys: "Enter", label: strings.shortcuts.openSelected },
      { keys: "Esc", label: "Close / clear" },
    ],
  },
  {
    name: strings.shortcuts.groupActions,
    items: [
      { keys: "⌘K", label: strings.shortcuts.openPalette },
      { keys: "?", label: strings.shortcuts.openShortcuts },
      { keys: "⌘B", label: strings.shortcuts.toggleSidebar },
      { keys: "E", label: strings.actions.edit },
    ],
  },
  {
    name: strings.shortcuts.groupTheme,
    items: [
      { keys: "⌘⇧D", label: strings.shortcuts.toggleTheme },
    ],
  },
];

export function ShortcutModal({ open, onClose, groups = DEFAULT_GROUPS, title = strings.shortcuts.title }: Props) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Snapshot the element that had focus before opening, then restore on close.
  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    closeRef.current?.focus();
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [open]);

  // Escape closes. Tab cycles inside (trivial focus trap — close only).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      data-testid="shortcut-modal"
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--bg-canvas) 70%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
      onClick={(e) => {
        // Click-outside closes. Anything inside stopPropagations.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-modal-title"
        style={{
          width: "min(480px, 92vw)",
          maxHeight: "80vh",
          overflow: "auto",
          background: "var(--bg-canvas)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
          padding: "16px 20px",
          fontFamily: "var(--font-sans)",
          color: "var(--text-primary)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2
            id="shortcut-modal-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              fontSize: 18,
            }}
          >
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: 4,
              padding: "2px 8px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Esc
          </button>
        </header>
        {groups.map((group) => (
          <section key={group.name} style={{ marginBottom: 12 }}>
            <h3
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-secondary)",
                margin: "0 0 6px",
              }}
            >
              {group.name}
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {group.items.map((item) => (
                <li
                  key={`${group.name}:${item.keys}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "4px 0",
                    borderTop: "1px solid var(--border-default)",
                    fontSize: 13,
                  }}
                >
                  <span>{item.label}</span>
                  <kbd
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-default)",
                      borderRadius: 3,
                      padding: "1px 6px",
                    }}
                  >
                    {item.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export default ShortcutModal;
