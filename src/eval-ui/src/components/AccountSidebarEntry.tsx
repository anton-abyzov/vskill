// 0834 T-027 + T-028 — AccountSidebarEntry.
//
// A single sidebar row used by both the Tauri desktop sidebar and the
// `npx vskill studio` browser sidebar to enter the AccountShell. Hosts
// (App.tsx in either surface) render this entry below the existing
// "Skills" sidebar — it sits in a separate <section> so the existing
// Sidebar.tsx skill-section partitioning code stays untouched.
//
// The component is rendering-pure: it knows whether it's "active" and
// fires a callback when clicked. Persistent state (which surface is
// open) lives in the host App.

export interface AccountSidebarEntryProps {
  active: boolean;
  onClick: () => void;
  /**
   * Optional unread count badge — used when the platform reports a
   * pending action (e.g. "1 export ready"). Hidden when 0/undefined.
   */
  badgeCount?: number;
}

export function AccountSidebarEntry({
  active,
  onClick,
  badgeCount,
}: AccountSidebarEntryProps) {
  return (
    <button
      type="button"
      data-testid="account-sidebar-entry"
      data-active={active ? "true" : "false"}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "left",
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
        background: active
          ? "var(--bg-canvas, #f3f4f6)"
          : "transparent",
        border: "none",
        borderLeft: `3px solid ${
          active ? "var(--color-accent, #2563eb)" : "transparent"
        }`,
        cursor: "pointer",
      }}
    >
      <span aria-hidden>👤</span>
      <span style={{ flex: 1 }}>Account</span>
      {badgeCount && badgeCount > 0 ? (
        <span
          style={{
            padding: "1px 6px",
            fontSize: 10,
            fontWeight: 600,
            background: "var(--color-accent, #2563eb)",
            color: "#fff",
            borderRadius: 999,
          }}
        >
          {badgeCount}
        </span>
      ) : null}
    </button>
  );
}
