// ---------------------------------------------------------------------------
// 0747 T-008: InstallLocationChips
//
// Renders a chip strip below the skill detail title showing every install
// location. When N==1 → renders nothing (avoid clutter for the common case).
// Per chip: scope · agentLabel, with optional 📌 (pinned globally) or 🔒
// (plugin-bundled / readonly) markers. Non-readonly, non-pinned chips show a
// small "Update" affordance that calls the per-location update endpoint via
// the parent's onUpdateLocation callback.
// ---------------------------------------------------------------------------

import type { InstallLocation } from "../api";

interface Props {
  locations: ReadonlyArray<InstallLocation>;
  pinned?: boolean;
  onChipClick?: (loc: InstallLocation) => void;
  onUpdateLocation?: (loc: InstallLocation) => void;
}

export function InstallLocationChips({
  locations,
  pinned = false,
  onChipClick,
  onUpdateLocation,
}: Props) {
  if (locations.length <= 1) return null;

  return (
    <div
      data-testid="install-location-chips"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "6px 16px 0",
      }}
    >
      {locations.map((loc, i) => {
        const labelParts: string[] = [];
        if (loc.scope === "plugin" && loc.pluginSlug) {
          labelParts.push(`plugin: ${loc.pluginSlug}`);
        } else {
          labelParts.push(loc.scope);
        }
        labelParts.push("·");
        labelParts.push(loc.agentLabel);
        if (pinned) labelParts.push("📌");
        if (loc.readonly) labelParts.push("🔒");

        const showUpdate = !loc.readonly && !pinned && onUpdateLocation;

        return (
          <span
            key={`${loc.scope}-${loc.agent}-${loc.dir}-${i}`}
            data-testid="install-location-chip"
            data-scope={loc.scope}
            data-agent={loc.agent}
            data-readonly={loc.readonly ? "true" : "false"}
            // 0747 grill F-003: when onChipClick is wired (follow-up
            // increment for AC-US3-04), expose keyboard + screen-reader
            // semantics. Until then `role` defaults to span semantics
            // and the keyboard handler is a no-op.
            role={onChipClick ? "button" : undefined}
            tabIndex={onChipClick ? 0 : undefined}
            aria-label={
              onChipClick
                ? `Open SKILL.md from ${loc.scope} (${loc.agentLabel})`
                : undefined
            }
            onClick={() => {
              if (onChipClick) onChipClick(loc);
            }}
            onKeyDown={(e) => {
              if (!onChipClick) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onChipClick(loc);
              }
            }}
            title={loc.dir}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid var(--border-default)",
              background: loc.readonly
                ? "var(--bg-surface-muted, transparent)"
                : "var(--bg-surface)",
              fontSize: 11,
              fontFamily: "var(--font-sans)",
              color: "var(--text-secondary)",
              cursor: onChipClick ? "pointer" : "default",
            }}
          >
            <span>{labelParts.join(" ")}</span>
            {showUpdate ? (
              <button
                type="button"
                data-testid="install-location-chip-update"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateLocation!(loc);
                }}
                title={`Update ${loc.scope} (${loc.agentLabel}) only`}
                style={{
                  marginLeft: 4,
                  padding: "0 6px",
                  background: "var(--color-ink)",
                  color: "var(--color-paper)",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  fontSize: 10,
                  fontWeight: 500,
                }}
              >
                Update
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
