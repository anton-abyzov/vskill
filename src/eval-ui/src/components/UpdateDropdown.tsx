import { useEffect, useRef } from "react";
import type { SkillUpdateInfo } from "../api";
import { classifyBump, BUMP_COLORS } from "../utils/semverBump";

interface Props {
  updates: SkillUpdateInfo[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onSelectSkill: (u: SkillUpdateInfo) => void;
  onViewAll: () => void;
  onClose: () => void;
  /** DOM node the popover is anchored to — used to return focus on close. */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /**
   * 0708 AC-US5-03: diff summaries keyed by `<plugin>/<skill>`, sourced
   * from the push update store. When a row's `name` matches a key, the
   * one-line summary is rendered below the version transition.
   */
  diffSummariesById?: ReadonlyMap<string, string>;
}

/**
 * 0683 T-007: Popover listing outdated skills, a manual Refresh action, and a
 * "View all" link to the existing `UpdatesPanel`. Dynamically imported from
 * `<UpdateBell />` so the closed bell stays light (see ADR-0681-03).
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="false"` (popover, not modal).
 *   - Outside-click and `Escape` close the dropdown.
 *   - Focus lands on the first interactive row on mount.
 */
export default function UpdateDropdown({
  updates,
  isRefreshing,
  onRefresh,
  onSelectSkill,
  onViewAll,
  onClose,
  anchorRef,
  diffSummariesById,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Focus the first row on mount (or the Refresh button if the list is empty).
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  // Outside-click to close (uses mousedown to beat focus movement).
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      if (anchorRef?.current && anchorRef.current.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [onClose, anchorRef]);

  // Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        anchorRef?.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, anchorRef]);

  const outdated = updates.filter((u) => u.updateAvailable);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label="Skill update summary"
      data-testid="update-dropdown"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: 320,
        maxHeight: 400,
        overflow: "auto",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        padding: 10,
        zIndex: 1000,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "2px 4px 6px",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          {outdated.length === 0
            ? "No updates available"
            : `${outdated.length} updates available`}
        </span>
        <button
          type="button"
          data-testid="update-dropdown-refresh"
          onClick={onRefresh}
          disabled={isRefreshing}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            cursor: isRefreshing ? "not-allowed" : "pointer",
            padding: "2px 6px",
          }}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {outdated.length > 0 ? (
        <ul
          role="list"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {outdated.map((u, i) => {
            const bump = u.latest ? classifyBump(u.installed, u.latest) : "patch";
            const c = BUMP_COLORS[bump];
            const diff = diffSummariesById?.get(u.name);
            return (
              <li key={u.name} style={{ margin: 0 }}>
                <button
                  ref={i === 0 ? firstItemRef : undefined}
                  type="button"
                  data-testid="update-dropdown-row"
                  data-skill-name={u.name}
                  onClick={() => onSelectSkill(u)}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    width: "100%",
                    padding: "6px 8px",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    color: "var(--text-primary)",
                    fontFamily: "inherit",
                    fontSize: 12,
                    textAlign: "left",
                  }}
                >
                  <span
                    aria-hidden="true"
                    data-testid="update-dropdown-bump-dot"
                    data-bump={bump}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: c.text,
                      flexShrink: 0,
                      marginTop: 4,
                    }}
                  />
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {u.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--text-secondary)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {u.installed} → {u.latest ?? "?"}
                      </span>
                    </span>
                    {diff && (
                      <span
                        data-testid="update-dropdown-diff-summary"
                        style={{
                          fontSize: 11,
                          color: "var(--text-secondary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {diff}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div style={{ padding: "12px 4px", fontSize: 12, color: "var(--text-secondary)" }}>
          All installed skills are up to date.
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          padding: "4px 4px 0",
          borderTop: "1px solid var(--border-default)",
          marginTop: 2,
        }}
      >
        <button
          type="button"
          data-testid="update-dropdown-view-all"
          onClick={onViewAll}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
            cursor: "pointer",
            padding: "4px 6px",
          }}
        >
          View all
        </button>
      </div>
    </div>
  );
}
