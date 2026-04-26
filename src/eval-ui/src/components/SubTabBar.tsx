// ---------------------------------------------------------------------------
// 0774 T-001: SubTabBar — secondary tab bar nested under a top-level
// RightPanel tab. Used to expose Run|History|Models under Run, and
// Run|History under Trigger (Activation).
//
// Visual: same 2px-underline pattern as the top-level bar but at smaller
// font (12px) and tighter padding (6px-8px) so it visually nests as a
// child of the top tab.
// ---------------------------------------------------------------------------

export interface SubTabDescriptor {
  id: string;
  label: string;
}

export interface SubTabBarProps {
  /** Tab descriptors — order is render order. */
  tabs: SubTabDescriptor[];
  /** Currently active sub-tab id. */
  active: string;
  /** Fires when the user clicks a sub-tab. */
  onChange: (id: string) => void;
  /** ID of the parent top-level tab (e.g. "run", "activation"). Used to scope
   *  data-testid attributes so component tests can address sub-tabs uniquely
   *  even when two SubTabBars exist in the tree. */
  parentTabId: string;
}

export function SubTabBar({ tabs, active, onChange, parentTabId }: SubTabBarProps) {
  return (
    <div
      role="tablist"
      aria-label={`${parentTabId} sub-sections`}
      data-testid={`detail-subtab-bar-${parentTabId}`}
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 2,
        borderBottom: "1px solid var(--border-subtle, var(--border-default))",
        padding: "0 16px",
        background: "var(--bg-canvas)",
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            id={`detail-subtab-${parentTabId}-${t.id}`}
            data-testid={`detail-subtab-${parentTabId}-${t.id}`}
            onClick={() => onChange(t.id)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: isActive
                ? "2px solid var(--text-primary)"
                : "2px solid transparent",
              padding: "6px 8px",
              marginBottom: -1,
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              fontWeight: isActive ? 500 : 400,
              color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
