import { useState, useCallback, type ReactNode } from "react";

export type SectionOrigin = "source" | "installed";

interface Props {
  origin: SectionOrigin;
  count: number;
  /** Optional filtered count (when a search is active). */
  filteredCount?: number | null;
  children?: ReactNode;
}

const STORAGE_KEYS: Record<SectionOrigin, string> = {
  source: "vskill-sidebar-own-collapsed",
  installed: "vskill-sidebar-installed-collapsed",
};

const LABELS: Record<SectionOrigin, string> = {
  source: "Own",
  installed: "Installed",
};

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "true" : "false");
  } catch {
    /* private browsing — ignore */
  }
}

/**
 * Sidebar section for one origin (OWN / INSTALLED).
 *
 * - Both default to expanded; user collapse state persists per-section in
 *   localStorage (`vskill-sidebar-own-collapsed`, `vskill-sidebar-installed-collapsed`).
 * - Header shows count in tabular-nums. When `filteredCount` is provided it
 *   renders `(N of M)` to make search scope explicit.
 * - Header is an <h2> inside a clickable <button> with aria-expanded.
 */
export function SidebarSection({ origin, count, filteredCount, children }: Props) {
  const storageKey = STORAGE_KEYS[origin];
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(storageKey));

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(storageKey, next);
      return next;
    });
  }, [storageKey]);

  const label = LABELS[origin];
  const headerId = `sidebar-section-${origin}-header`;
  const groupId = `sidebar-section-${origin}-group`;

  return (
    <section
      aria-labelledby={headerId}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <button
        id={headerId}
        type="button"
        data-testid="sidebar-section-header"
        aria-expanded={!collapsed}
        aria-controls={groupId}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px 6px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          textAlign: "left",
        }}
      >
        <Chevron collapsed={collapsed} />
        <h2
          aria-level={2}
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-primary)",
            margin: 0,
          }}
        >
          {label}
        </h2>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filteredCount != null && filteredCount !== count
            ? `(${filteredCount} of ${count})`
            : `(${count})`}
        </span>
      </button>
      {!collapsed && (
        <div
          id={groupId}
          role="group"
          aria-labelledby={headerId}
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--text-secondary)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
        transition: "transform var(--duration-fast, 120ms) var(--ease-standard, ease)",
        flexShrink: 0,
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
