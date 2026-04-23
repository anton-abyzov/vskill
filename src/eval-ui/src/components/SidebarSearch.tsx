import { useEffect, useId, useRef } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /**
   * Optional validation pattern. When set and the current value is non-empty
   * and does NOT match the pattern, the input surfaces a validation error:
   * aria-invalid="true" is set and aria-describedby points to a rendered
   * error message. Cleared automatically when the value is empty or valid.
   *
   * Added for T-054 (AC-US8-08) — wires form validation into AT.
   */
  validationPattern?: RegExp;
  /** Human-readable message shown when validationPattern fails. */
  validationMessage?: string;
}

export interface Matchable {
  skill: string;
  plugin: string;
  dir: string;
}

/**
 * Lightweight matcher used by Sidebar to filter both sections.
 *
 * Uses simple case-insensitive substring match across skill name, plugin
 * name, and dir. This intentionally does NOT pull in fuse.js — the payload
 * cost (~25KB gzipped) is not justified for a list that rarely exceeds a
 * few hundred items, and simple substring is the matcher users expect from
 * "/" filter bars (Raycast, Linear). Scoring can be added later without
 * breaking the API.
 */
export function matchSkillQuery(m: Matchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.skill.toLowerCase().includes(q) ||
    m.plugin.toLowerCase().includes(q) ||
    m.dir.toLowerCase().includes(q)
  );
}

/**
 * Sidebar search input.
 *
 * - `/` from anywhere outside a text input focuses this field.
 * - `Escape` clears the value and blurs.
 * - Controlled by parent: `value` + `onChange`.
 */
export function SidebarSearch({
  value,
  onChange,
  placeholder = "Filter skills…",
  validationPattern,
  validationMessage = "Invalid filter expression",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  // Validation fires only when a pattern is provided AND the user has typed
  // something that does NOT match. Empty input is never invalid (a11y spec
  // AC-US8-08: errors describe invalid input, not required fields).
  const hasError =
    Boolean(validationPattern) && value.trim() !== "" && !validationPattern!.test(value);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Don't hijack "/" while the user is typing somewhere.
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      role="search"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        aria-label="Filter skills"
        aria-invalid={hasError ? true : undefined}
        aria-describedby={hasError ? errorId : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            e.currentTarget.blur();
          }
        }}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          padding: "2px 0",
        }}
      />
      {hasError && (
        <span
          id={errorId}
          role="alert"
          aria-live="polite"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 10,
            color: "var(--text-error, #B42318)",
            marginLeft: 4,
            whiteSpace: "nowrap",
          }}
        >
          {validationMessage}
        </span>
      )}
      <kbd
        aria-hidden="true"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-secondary)",
          border: "1px solid var(--border-default)",
          padding: "1px 5px",
          borderRadius: 3,
          display: value ? "none" : "inline-block",
        }}
      >
        /
      </kbd>
    </div>
  );
}
