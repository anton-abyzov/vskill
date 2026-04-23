import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { useStudio } from "../StudioContext";
import updateBellIcon from "../assets/icons/update-bell.svg";

// Lazy-load the popover body so the closed bell stays ≤2KB gzipped.
const UpdateDropdown = lazy(() => import("./UpdateDropdown"));

/**
 * 0683 T-006: Bell icon + count badge for the TopRail.
 *
 * Reads `updateCount`, `updates`, `refreshUpdates`, `isRefreshingUpdates`
 * from `StudioContext`. When clicked, mounts `UpdateDropdown` (lazy).
 */
export function UpdateBell() {
  const {
    updateCount,
    updates,
    isRefreshingUpdates,
    refreshUpdates,
    selectSkill,
  } = useStudio();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const bellColor =
    updateCount > 0 ? "var(--text-primary)" : "var(--text-secondary)";
  const badgeText = updateCount > 9 ? "9+" : String(updateCount);
  const ariaLabel =
    updateCount === 0
      ? "No updates available"
      : `${updateCount} updates available, open summary`;

  return (
    <span
      data-testid="update-bell-anchor"
      style={{ position: "relative", display: "inline-flex" }}
    >
      <button
        ref={btnRef}
        type="button"
        data-testid="update-bell"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          height: 26,
          width: 26,
          padding: 0,
          borderRadius: 4,
          border: "1px solid transparent",
          background: "transparent",
          color: bellColor,
          cursor: "pointer",
        }}
      >
        <img
          src={updateBellIcon}
          alt=""
          width={18}
          height={18}
          style={{ display: "block", opacity: updateCount > 0 ? 1 : 0.75 }}
        />
        {updateCount > 0 && (
          <span
            data-testid="update-bell-badge"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 14,
              height: 14,
              padding: "0 3px",
              borderRadius: 999,
              background: "var(--color-own)",
              color: "var(--color-paper)",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              lineHeight: 1,
            }}
          >
            {badgeText}
          </span>
        )}
      </button>
      {open && (
        <Suspense fallback={<span data-testid="update-bell-fallback">Loading…</span>}>
          <UpdateDropdown
            updates={updates}
            isRefreshing={isRefreshingUpdates}
            onRefresh={() => refreshUpdates()}
            onSelectSkill={(u) => {
              const parts = u.name.split("/");
              const plugin = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
              const skill = parts[parts.length - 1];
              selectSkill({ plugin, skill, origin: "installed" });
              close();
            }}
            onViewAll={() => {
              window.location.hash = "#/updates";
              close();
            }}
            onClose={close}
            anchorRef={btnRef}
          />
        </Suspense>
      )}
    </span>
  );
}
