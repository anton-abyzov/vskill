import { useCallback, useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// 0686 T-007 + T-009 (US-003, US-004): ScopeSection — tri-scope sidebar
// primitive built on top of (not in place of) SidebarSection.
//
// Differences from SidebarSection:
//   - Adds a "global" scope variant + a new color token (--color-global).
//   - Typography: 14px Source Serif 4, uppercase, letter-spacing 0.12em.
//     Replaces the old 11px Inter kicker per AC-US4-01.
//   - Per-agent collapse persistence: key pattern
//     `vskill-sidebar-<agentId>-<scope>-collapsed`. This deliberately
//     diverges from the legacy `vskill-sidebar-{own,installed}-collapsed`
//     keys that SidebarSection still uses for backward-compat (spec §5
//     keeps them as-is for continuity).
//   - Status dot (fresh / updates / empty) — replaces the hairline status
//     indicator with an explicit colored pip.
//
// Dividers are still owned by the Sidebar wrapper so the 3px block with
// inset shadow can extend beyond the section container (T-009).
// ---------------------------------------------------------------------------

export type Scope = "own" | "installed" | "global";

export interface ScopeSectionProps {
  scope: Scope;
  agentId: string;
  count: number;
  filteredCount?: number | null;
  updateCount?: number;
  children?: ReactNode;
}

const LABELS: Record<Scope, string> = {
  own: "Own",
  installed: "Installed",
  global: "Global",
};

const COLOR_VARS: Record<Scope, string> = {
  own: "var(--color-own)",
  installed: "var(--color-accent)",
  // --color-global is a new token (slate violet, light #8B8FB1 / dark #6F748F)
  // owned by 0674's polish-styles. Until that token lands we render with an
  // inline fallback so the visual lands today.
  global: "var(--color-global, #8B8FB1)",
};

type Status = "fresh" | "updates" | "empty";

const STATUS_COLORS: Record<Status, string> = {
  fresh: "var(--color-ok, #22c55e)",
  updates: "var(--color-own, #f59e0b)",
  empty: "var(--text-tertiary, #9ca3af)",
};

function storageKey(agentId: string, scope: Scope): string {
  return `vskill-sidebar-${agentId}-${scope}-collapsed`;
}

function readCollapsed(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v === "true";
  } catch {
    /* storage unavailable — default expanded */
  }
  return false;
}

function writeCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, collapsed ? "true" : "false");
  } catch {
    /* private browsing / quota — ignore */
  }
}

function computeStatus(count: number, updateCount: number): Status {
  if (count === 0) return "empty";
  if (updateCount > 0) return "updates";
  return "fresh";
}

export function ScopeSection({
  scope,
  agentId,
  count,
  filteredCount,
  updateCount = 0,
  children,
}: ScopeSectionProps) {
  const key = storageKey(agentId, scope);
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed(key));
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(key, next);
      return next;
    });
  }, [key]);

  const label = LABELS[scope];
  const kickerColor = COLOR_VARS[scope];
  const status = computeStatus(count, updateCount);
  const headerId = `scope-section-${agentId}-${scope}-header`;
  const groupId = `scope-section-${agentId}-${scope}-group`;

  return (
    <section
      aria-labelledby={headerId}
      data-testid={`scope-section-${scope}`}
      data-scope={scope}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <button
        id={headerId}
        type="button"
        data-testid="scope-section-header"
        aria-expanded={!collapsed}
        aria-controls={groupId}
        onClick={toggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          // 12px top, 4px bottom per AC-US4-03.
          padding: "12px 14px 4px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          textAlign: "left",
        }}
      >
        <Chevron collapsed={collapsed} />
        <span
          data-testid="scope-status-dot"
          data-status={status}
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: STATUS_COLORS[status],
            flexShrink: 0,
          }}
        />
        <h2
          data-testid="scope-section-kicker"
          aria-level={2}
          style={{
            // AC-US4-01: 14px Source Serif 4, weight 600, uppercase,
            // letter-spacing 0.12em, explicit caps (smcp off).
            fontFamily: "'Source Serif 4 Variable', 'Source Serif 4', serif",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFeatureSettings: '"smcp" 0',
            color: kickerColor,
            margin: 0,
          }}
        >
          {label}
        </h2>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "var(--font-mono)",
          }}
        >
          {filteredCount != null && filteredCount !== count
            ? `(${filteredCount} of ${count})`
            : `(${count})`}
        </span>
        {updateCount > 0 && (
          <UpdateCountChip updateCount={updateCount} scope={scope} />
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

function UpdateCountChip({
  updateCount,
  scope,
}: {
  updateCount: number;
  scope: Scope;
}) {
  return (
    <span
      role="link"
      tabIndex={0}
      data-testid="scope-section-update-chip"
      data-scope={scope}
      aria-label={`${updateCount} updates available in ${LABELS[scope].toLowerCase()} section`}
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
      style={{
        fontSize: 10,
        color: "var(--color-own)",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        cursor: "pointer",
        padding: "0 4px",
        borderRadius: 3,
      }}
    >
      {updateCount} updates ▾
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
        transition:
          "transform var(--duration-fast, 120ms) var(--ease-standard, ease)",
        flexShrink: 0,
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
