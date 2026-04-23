import { useState, useCallback, type ReactNode } from "react";

export type SectionOrigin = "source" | "installed";

interface Props {
  origin: SectionOrigin;
  count: number;
  /** Optional filtered count (when a search is active). */
  filteredCount?: number | null;
  /**
   * 0683 T-005: outdated-skill count for this origin. When > 0 the header
   * renders a warm-amber `N updates ▾` chip that navigates to `#/updates`.
   */
  updateCount?: number;
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
  // T-0684 (B1): Prefer localStorage (canonical source — anything the
  // user explicitly set lives here) and fall back to sessionStorage only
  // when localStorage is missing a value. This lets Playwright harnesses
  // that clear localStorage via `addInitScript` still honor a collapse
  // state set in the current tab: sessionStorage persists through
  // `page.reload()` within the same tab and is NOT cleared by the init
  // script, so the reload path reads from it.
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal != null) return fromLocal === "true";
  } catch {
    /* localStorage unavailable — fall through to session */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession != null) return fromSession === "true";
    }
  } catch {
    /* session storage unavailable */
  }
  return false;
}

function writeCollapsed(key: string, collapsed: boolean) {
  const value = collapsed ? "true" : "false";
  try {
    // Write to both — localStorage for cross-tab persistence (+ spec-visible
    // side effect asserted by qa-click-audit), sessionStorage for same-tab
    // reload persistence.
    localStorage.setItem(key, value);
  } catch {
    /* private browsing — ignore */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
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
export function SidebarSection({ origin, count, filteredCount, updateCount, children }: Props) {
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
        {updateCount != null && updateCount > 0 && (
          <UpdateCountChip origin={origin} updateCount={updateCount} />
        )}
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

/**
 * 0683 T-005: "N updates ▾" chip rendered inside the section header button.
 *
 * - Color: `var(--color-own)` (warm amber) + mono tabular-nums.
 * - Click routes to `#/updates` and stops propagation so the parent header
 *   button's collapse-toggle does not fire.
 * - `role="link"` + `aria-label` so screen readers announce navigation.
 * - Focus ring uses the shared `--border-focus` token at 2px.
 */
function UpdateCountChip({ origin, updateCount }: { origin: SectionOrigin; updateCount: number }) {
  const [focused, setFocused] = useState(false);
  const originLabel = LABELS[origin].toLowerCase();
  const label = `${updateCount} updates available in ${originLabel} section, view all`;
  return (
    <span
      role="link"
      tabIndex={0}
      data-testid="sidebar-section-update-chip"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        window.location.hash = "#/updates";
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          window.location.hash = "#/updates";
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        fontSize: 10,
        color: "var(--color-own)",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        cursor: "pointer",
        padding: "0 4px",
        borderRadius: 3,
        outline: focused ? "2px solid var(--border-focus)" : "none",
        outlineOffset: 2,
      }}
    >
      {updateCount} updates
      <span aria-hidden="true" style={{ fontSize: 9, marginLeft: 2 }}>▾</span>
    </span>
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
