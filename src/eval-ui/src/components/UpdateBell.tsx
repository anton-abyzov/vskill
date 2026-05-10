import { Suspense, lazy, useCallback, useId, useMemo, useRef, useState } from "react";
import { useStudio } from "../StudioContext";
import { useToast } from "./ToastProvider";
import { usePlatformHealth } from "../hooks/usePlatformHealth";

// Lazy-load the popover body so the closed bell stays ≤2KB gzipped.
const UpdateDropdown = lazy(() => import("./UpdateDropdown"));

/**
 * 0838 T-004: status → label + color-token mapping for the bell pip.
 * AC-US4-01 governs the color tokens; AC-US1-04 governs the labels.
 */
function statusLabel(status: "connecting" | "connected" | "fallback"): string {
  switch (status) {
    case "connected":
      return "connected";
    case "fallback":
      return "reconnecting";
    case "connecting":
    default:
      return "connecting";
  }
}

function statusPipColor(status: "connecting" | "connected" | "fallback"): string {
  switch (status) {
    case "connected":
      return "var(--status-success-text)";
    case "fallback":
      return "var(--color-own)";
    case "connecting":
    default:
      return "var(--text-secondary)";
  }
}

/**
 * 0683 T-006: Bell icon + count badge for the TopRail.
 *
 * Reads `updateCount`, `updates`, `refreshUpdates`, `isRefreshingUpdates`
 * from `StudioContext`. When clicked, mounts `UpdateDropdown` (lazy).
 *
 * 0747 T-006: row click resolves the actual sidebar skill via revealSkill
 * using server-provided localPlugin/localSkill. Falls back to last-segment
 * split for older servers. Surfaces a toast naming the owning agent when no
 * match is found in current state.
 */
export function UpdateBell() {
  const {
    updateCount,
    updates,
    isRefreshingUpdates,
    refreshUpdates,
    selectSkill,
    revealSkill,
    skills,
    updatesById,
    activeAgent,
    updateStreamStatus,
    trackedSkillCount,
  } = useStudio() as ReturnType<typeof useStudio> & {
    revealSkill: (plugin: string, skill: string) => void;
    skills?: Array<{ plugin: string; skill: string; source?: string }>;
    activeAgent?: string | null;
    updateStreamStatus?: "connecting" | "connected" | "fallback";
    /**
     * 0838 AC-US4-02: total tracked-skill count (installed + source-origin
     * with a registry twin). When zero, no SSE is attempted and the pip
     * is suppressed — there's no signal worth showing.
     */
    trackedSkillCount?: number;
  };
  const { toast } = useToast();
  // 0778 — surface upstream-degraded state on the bell icon (colour +
  // tooltip). 0781: the in-dropdown banner was removed; the bell is now
  // the only signal here.
  const { data: platformHealth } = usePlatformHealth();
  const platformDegraded = platformHealth?.degraded === true;

  // 0838: stable a11y id for the hidden status-text span so the bell
  // button can reference it via aria-describedby (AC-US1-04).
  const statusTextId = useId();
  const liveStatus = updateStreamStatus ?? "connecting";
  const tracked = typeof trackedSkillCount === "number" ? trackedSkillCount : null;
  // Pip is only shown when SSE has something to track. When tracked is
  // explicitly null (legacy callers that don't pass it), default to showing
  // the pip — back-compat with consumers that haven't adopted the new field.
  const pipVisible = tracked === null ? true : tracked > 0;

  // 0708 AC-US5-03: project push-store entries → short-name-keyed diff
  // summaries so UpdateDropdown can render the one-liner under each row.
  // `updates[].name` is "<plugin>/<skill>"; updatesById keys match.
  const diffSummariesById = useMemo(() => {
    if (!updatesById || updatesById.size === 0) return undefined;
    const out = new Map<string, string>();
    for (const [id, entry] of updatesById) {
      if (entry.diffSummary) out.set(id, entry.diffSummary);
    }
    return out.size > 0 ? out : undefined;
  }, [updatesById]);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // 0778 — when the platform pipeline is degraded, the glyph shifts to the
  // amber warn token and the aria/title labels include the degraded state.
  // The healthy path is unchanged.
  const bellColor = platformDegraded
    ? "var(--color-own)"
    : updateCount > 0
      ? "var(--text-primary)"
      : "var(--text-secondary)";
  const badgeText = updateCount > 9 ? "9+" : String(updateCount);
  const baseAriaLabel =
    updateCount === 0
      ? "No updates available"
      : `${updateCount} updates available, open summary`;
  const ariaLabel = platformDegraded
    ? `${baseAriaLabel} — platform crawler degraded`
    : baseAriaLabel;
  const titleAttr = platformDegraded
    ? "Update checks paused — verified-skill.com crawler is degraded. Your submissions are queued."
    : undefined;

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
        aria-describedby={statusTextId}
        title={titleAttr}
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
        {/* 0778 — inline SVG so the parent `color` (bellColor) actually
            tints the icon. The previous <img src={icon}> path didn't
            propagate currentColor. */}
        <svg
          data-testid="update-bell-icon"
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          style={{
            display: "block",
            opacity: updateCount > 0 || platformDegraded ? 1 : 0.75,
            color: bellColor,
          }}
        >
          <path d="M5.5 17h11l-1.2-1.8a2 2 0 0 1-.3-1.1V10a4 4 0 1 0-8 0v4.1a2 2 0 0 1-.3 1.1L5.5 17Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
          <circle cx="17" cy="7" r="2.2" fill="currentColor" stroke="none" />
        </svg>
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
        {/* 0838 T-004 AC-US4-01: 6px colored pip in the bottom-right of the
            icon. Hidden when there's nothing to track (AC-US4-02). */}
        {pipVisible && (
          <span
            data-testid="update-bell-status-pip"
            aria-hidden="true"
            style={{
              position: "absolute",
              bottom: -1,
              right: -1,
              width: 6,
              height: 6,
              borderRadius: 999,
              background: statusPipColor(liveStatus),
              border: "1px solid var(--color-paper)",
              display: "inline-block",
              lineHeight: 0,
            }}
          />
        )}
      </button>
      {/* 0838 T-003 AC-US1-04: hidden status text linked via aria-describedby.
          Visually offscreen but read by screen readers. */}
      <span
        id={statusTextId}
        data-testid="update-bell-status-text"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {`Live updates: ${statusLabel(liveStatus)}`}
      </span>
      {open && (
        <Suspense fallback={<span data-testid="update-bell-fallback">Loading…</span>}>
          <UpdateDropdown
            updates={updates}
            isRefreshing={isRefreshingUpdates}
            diffSummariesById={diffSummariesById}
            onRefresh={() => refreshUpdates()}
            onSelectSkill={(u) => {
              // 0747 T-006: prefer server-resolved local fs identifiers over
              // a naive split of the canonical platform name. revealSkill's
              // F-001 (no-plugin guard) and F-002 (non-plugin-source
              // fallback) handle the matching against current sidebar state.
              const localSkill =
                u.localSkill ?? u.name.split("/").pop() ?? "";
              const localPlugin = u.localPlugin ?? "";
              if (revealSkill) {
                revealSkill(localPlugin, localSkill);
              } else {
                // Defensive: pre-0747 contexts without revealSkill exposed
                // fall back to the legacy selectSkill flow.
                const parts = u.name.split("/");
                const plugin =
                  parts.length >= 2 ? parts[parts.length - 2] : parts[0];
                selectSkill({
                  plugin,
                  skill: localSkill,
                  origin: "installed",
                });
              }
              // If no matching row exists in the current sidebar state, surface
              // the owning agent via toast so the user knows where to look.
              const matched = (skills ?? []).some(
                (s) =>
                  s.skill === localSkill &&
                  (localPlugin === "" || s.plugin === localPlugin),
              );
              if (!matched) {
                const installLocations = u.installLocations ?? [];
                if (installLocations.length > 0) {
                  // 0761 US-004: prefer informational wording when the click
                  // target's installLocations include the current agent. The
                  // user is already viewing a valid copy of the skill — telling
                  // them to "switch to X" is misleading. Fall back to the
                  // legacy actionable wording only when the skill genuinely
                  // lives elsewhere.
                  const currentAgentLocations = activeAgent
                    ? installLocations.filter((loc) => loc.agent === activeAgent)
                    : [];
                  const otherAgentLocations = activeAgent
                    ? installLocations.filter((loc) => loc.agent !== activeAgent)
                    : installLocations;

                  if (currentAgentLocations.length > 0 && otherAgentLocations.length > 0) {
                    const message =
                      otherAgentLocations.length >= 2
                        ? `Also installed under ${otherAgentLocations.length} other locations.`
                        : `Also installed under ${otherAgentLocations[0].agentLabel}.`;
                    toast({ severity: "info", message });
                  } else {
                    const owner = installLocations[0].agentLabel;
                    toast({
                      severity: "info",
                      message: `Skill installed under ${owner} — switch to ${owner} to view details.`,
                    });
                  }
                }
              }
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
