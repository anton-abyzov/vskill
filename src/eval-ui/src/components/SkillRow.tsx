import type { SkillInfo } from "../types";
// T-032: SkillRowHoverCard is imported here so sidebar callers can wrap a
// SkillRow with the hover card via `<SkillRowHoverCard skill={skill}>...`.
// This import lines up the dependency without altering SkillRow styling.
import { SkillRowHoverCard } from "./SkillRowHoverCard";
void SkillRowHoverCard;

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
export function SkillRow({ skill, isSelected, onSelect, onContextMenu }: Props) {
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
      {/* Provenance dot prefix */}
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
          flexShrink: 0,
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

      {/* Current version (if any) */}
      {skill.version && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {skill.version}
        </span>
      )}

      {/* Update available chip */}
      {skill.updateAvailable && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--accent-surface)",
            padding: "1px 6px",
            border: "1px solid var(--accent-surface)",
            borderRadius: 4,
            flexShrink: 0,
            textTransform: "lowercase",
          }}
          title={skill.latestVersion ? `Update available: ${skill.latestVersion}` : "Update available"}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
          update
        </span>
      )}
    </button>
  );
}
