import { useEffect, useMemo, useRef, useState } from "react";
import { strings } from "../strings";

/**
 * Command palette (T-039).
 *
 * Contract:
 *   - Opens when `open=true`; parent owns the Cmd+K trigger.
 *   - Input is autofocused on open. Focus is trapped inside the dialog.
 *   - Escape closes and restores focus to the element that had it before open.
 *   - Fuzzy search — simple scoring against command label + description +
 *     keywords. No Fuse dependency (keeps the lazy chunk small).
 *   - Arrow keys navigate the filtered list. Enter executes the highlighted
 *     command. Mouse hover also highlights.
 *   - ARIA: role="combobox" on the wrapper, role="listbox" + role="option"
 *     on the results.
 *
 * The component is the default export so App.tsx can lazy-load via
 * `React.lazy(() => import("./CommandPalette"))` — that pulls this file out
 * of the initial bundle entirely.
 */

export interface Command {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  onInvoke: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  /** Placeholder for the input (defaults to "Type a command…"). */
  placeholder?: string;
}

/** Tiny scoring: substring > word-start > fuzzy-contains. Returns 0 for no match. */
export function scoreCommand(cmd: Command, q: string): number {
  if (!q) return 1;
  const lower = q.toLowerCase();
  const haystack = [
    cmd.label,
    cmd.description ?? "",
    ...(cmd.keywords ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (haystack.startsWith(lower)) return 100;
  const labelLower = cmd.label.toLowerCase();
  if (labelLower.startsWith(lower)) return 90;
  if (labelLower.includes(lower)) return 80;
  if (haystack.includes(lower)) return 60;
  // Fuzzy: every character in order.
  let i = 0;
  for (const ch of haystack) {
    if (ch === lower[i]) i++;
    if (i === lower.length) return 40;
  }
  return 0;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder = strings.palette.inputPlaceholder,
}: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const triggerRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: scoreCommand(c, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
    return scored;
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    setQuery("");
    setCursor(0);
    // Focus after the DOM updates — requestAnimationFrame keeps jsdom happy.
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      triggerRef.current?.focus?.();
      triggerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        const picked = filtered[cursor];
        if (picked) {
          e.preventDefault();
          picked.onInvoke();
          onClose();
        }
        return;
      }
      // Focus trap — keep Tab inside the input.
      if (e.key === "Tab") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, filtered, cursor]);

  if (!open) return null;

  const listboxId = "command-palette-listbox";
  return (
    <div
      data-testid="command-palette"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--bg-canvas) 70%, transparent)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
        zIndex: 60,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: "min(560px, 92vw)",
          background: "var(--bg-canvas)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          boxShadow: "0 24px 64px rgba(0,0,0,0.2)",
          overflow: "hidden",
          fontFamily: "var(--font-sans)",
          color: "var(--text-primary)",
        }}
      >
        <div
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-haspopup="listbox"
          style={{ padding: "8px 12px", borderBottom: "1px solid var(--border-default)" }}
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            aria-label="Command"
            aria-autocomplete="list"
            aria-controls={listboxId}
            placeholder={placeholder}
            style={{
              width: "100%",
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              padding: "6px 0",
            }}
          />
        </div>
        <ul
          id={listboxId}
          role="listbox"
          style={{ listStyle: "none", margin: 0, padding: "4px 0", maxHeight: 320, overflow: "auto" }}
        >
          {filtered.length === 0 && (
            <li
              role="option"
              aria-selected="false"
              style={{
                padding: "10px 12px",
                color: "var(--text-secondary)",
                fontSize: 12,
              }}
            >
              {strings.palette.emptyResults}
            </li>
          )}
          {filtered.map((cmd, i) => (
            <li
              key={cmd.id}
              role="option"
              aria-selected={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => {
                cmd.onInvoke();
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background:
                  i === cursor
                    ? "color-mix(in srgb, var(--accent-surface) 10%, transparent)"
                    : "transparent",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <span>{cmd.label}</span>
              {cmd.description && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    marginLeft: 12,
                  }}
                >
                  {cmd.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default CommandPalette;
