import type { SkillInfo } from "../types";

/**
 * Minimal "update available" glyph for a `SkillRow` (0683 US-001).
 *
 * Design constraints (inherited from 0674 + 0683 plan §4):
 *   - 10×10 chevron-up SVG.
 *   - `color: var(--color-own)` (warm amber); no background fill.
 *   - Tooltip: `Update available: {installed} → {latest}` when both are known,
 *     else the generic `Update available`.
 *   - `data-testid="skill-row-update-glyph"` so tests and E2E can locate it.
 *
 * Renders `null` when the skill has no outstanding update.
 */
interface Props {
  skill: Pick<SkillInfo, "updateAvailable" | "currentVersion" | "latestVersion">;
}

export function UpdateBadge({ skill }: Props) {
  if (!skill.updateAvailable) return null;

  const installed = skill.currentVersion ?? "";
  const latest = skill.latestVersion;
  const title = latest
    ? `Update available: ${installed} → ${latest}`.trim()
    : "Update available";

  return (
    <span
      data-testid="skill-row-update-glyph"
      title={title}
      aria-label="Update available"
      style={{
        color: "var(--color-own)",
        display: "inline-flex",
        flexShrink: 0,
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </span>
  );
}
