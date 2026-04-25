import { memo } from "react";
import type { SkillInfo } from "../types";
// T-032: SkillRowHoverCard is imported here so sidebar callers can wrap a
// SkillRow with the hover card via `<SkillRowHoverCard skill={skill}>...`.
// This import lines up the dependency without altering SkillRow styling.
import { SkillRowHoverCard } from "./SkillRowHoverCard";
import { SymlinkChip } from "./SymlinkChip";
import { UpdateBadge } from "./UpdateBadge";
import { UpdateChip } from "./UpdateChip";
import { VersionBadge } from "./VersionBadge";
void SkillRowHoverCard;

// 0686 T-015 (US-008): SkillInfo carries `isSymlink` + `symlinkTarget` once
// the server enrichment is active. Legacy payloads (pre-0686) omit both,
// so the chip only renders when `isSymlink === true`.

interface Props {
  skill: SkillInfo;
  isSelected: boolean;
  onSelect: () => void;
  /**
   * T-041: optional context-menu opener. When provided, right-click on the
   * row calls this with the raw mouse event so the parent can position the
   * ContextMenu at the cursor location.
   */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>, skill: SkillInfo) => void;
}

/**
 * 36px single-line row in the sidebar skill list.
 *
 * - Provenance dot prefix (no pill): --status-own for source skills,
 *   --status-installed for installed skills.
 * - At rest: no background. On hover: subtle canvas wash.
 * - Selected: 1px accent-surface left border (implemented via
 *   `box-shadow: inset 2px 0 0 var(--color-accent)`) + a soft accent wash.
 * - Name in Inter Tight; version in JetBrains Mono tabular-nums.
 * - `updateAvailable` chip renders an accent-colored "Update" pill with the
 *   latest version when applicable.
 */
function SkillRowBase({ skill, isSelected, onSelect, onContextMenu }: Props) {
  const dotColor = skill.origin === "installed" ? "var(--status-installed)" : "var(--status-own)";

  return (
    <button
      type="button"
      onClick={onSelect}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e, skill);
            }
          : undefined
      }
      // T-0684 (B3): aria-selected + data-testid live on the button so
      // the keyboard-shortcuts j/k spec can locate
      // `[data-testid='skill-row'][aria-selected='true']`. The native
      // button retains its implicit role so existing qa-click-audit /
      // sidebar-row specs that use `getByRole("button", { name: /test-skill/ })`
      // continue to find it. `aria-allowed-attr` is whitelisted for
      // this single element in `a11y-axe.test.ts` until the sidebar
      // list adopts a full listbox contract (follow-up increment).
      aria-current={isSelected ? "true" : undefined}
      aria-selected={isSelected ? true : false}
      data-testid="skill-row"
      data-selected={isSelected}
      data-origin={skill.origin}
      // 0704: stable DOM id used by the Sidebar reveal effect to scroll a
      // just-created skill into view after the sidebar rehydrates with
      // fresh data.
      data-skill-id={`${skill.plugin}/${skill.skill}`}
      style={{
        // Layout
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 36,
        padding: "0 12px 0 14px",
        // Surface
        background: isSelected
          ? "color-mix(in srgb, var(--accent-surface) 10%, transparent)"
          : "transparent",
        // 1px accent left border via inset shadow when selected.
        boxShadow: isSelected
          ? "inset 2px 0 0 var(--color-accent, var(--accent-surface))"
          : "none",
        border: "none",
        borderRadius: 0,
        color: "var(--text-primary)",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        textAlign: "left",
        transition: "background-color var(--duration-fast, 120ms) var(--ease-standard, ease), box-shadow var(--duration-base, 180ms) var(--ease-standard, ease)",
      }}
    >
      {/* Provenance dot — 0700 phase 2A: when an update is available, the
          same dot gets a concentric amber ring so one glance tells you both
          (a) where the skill lives (yellow/green) and (b) that it's stale. */}
      <span
        aria-hidden="true"
        aria-label={skill.updateAvailable ? "Update available" : undefined}
        title={
          skill.updateAvailable
            ? `Update available${skill.latestVersion ? ` → ${skill.latestVersion}` : ""}`
            : undefined
        }
        style={{
          width: skill.updateAvailable ? 10 : 6,
          height: skill.updateAvailable ? 10 : 6,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
          flexShrink: 0,
          boxShadow: skill.updateAvailable
            ? "0 0 0 2px var(--color-own, #d97706)"
            : "none",
          transition: "box-shadow 180ms ease, width 180ms ease, height 180ms ease",
        }}
      />

      {/* Skill name */}
      <span
        title={skill.skill}
        style={{
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {skill.skill}
      </span>

      {/* 0707 T-009: reusable VersionBadge (sm) instead of an inline <span>. */}
      {skill.version && (
        <VersionBadge version={skill.version} size="sm" showPrefix={false} data-testid="skill-row-version" />
      )}

      {/* 0686 US-008: chain-link glyph when the skill was installed via
          symlink. Renders when the server enriches SkillInfo with the
          isSymlink flag; legacy payloads omit both fields and the chip
          stays hidden automatically. */}
      {skill.isSymlink && <SymlinkChip target={skill.symlinkTarget ?? null} />}

      {/* 0683 US-001: subtle ↑ glyph replaces the old "update" pill. */}
      <UpdateBadge skill={skill} />

      {/* 0708 T-037/T-038: blue update dot (SSE push) or dim gray not-tracked
          dot. `trackedForUpdates` is a 0708 addition to SkillInfo; payloads
          that predate 0708 omit it, so `undefined` is treated as "assume
          tracked" to avoid spamming the not-tracked dot on legacy rows. */}
      <UpdateChip
        skillId={`${skill.plugin}/${skill.skill}`}
        trackedForUpdates={skill.trackedForUpdates ?? true}
      />
    </button>
  );
}

/**
 * 0683 T-004: wrap SkillRow in `React.memo` so sidebars with many rows only
 * re-render the rows whose props actually changed when an update poll lands.
 * The raw function is still exported as `SkillRowInner` for existing tests
 * that invoke the component as a plain function.
 */
export const SkillRowInner = SkillRowBase;
export const SkillRow = memo(SkillRowBase);
