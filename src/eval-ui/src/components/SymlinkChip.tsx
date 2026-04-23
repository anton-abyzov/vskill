// ---------------------------------------------------------------------------
// 0686 T-015 (US-008): SymlinkChip — small inline glyph rendered inside
// SkillRow (and optionally the detail panel) when `skill.isSymlink === true`.
//
// - 10px chain-link SVG glyph, `data-testid="symlink-glyph"`.
// - Wrapping span carries `data-testid="symlink-chip"`, `aria-label`
//   + `title` containing the full target path so hover and assistive
//   technologies both surface the tooltip.
// - When `target` is null (cycle detected OR unresolved symlink), the
//   chip still renders so the row stays visually consistent, but the
//   tooltip falls back to a "symlinked — cycle detected" message (see
//   AC-US8-04 / scanner contract for the null semantics).
//
// `formatSymlinkTarget` is exported for callers (RightPanel detail row,
// hover cards) that want the mid-ellipsised label without re-implementing
// the truncation rule.
// ---------------------------------------------------------------------------

export interface SymlinkChipProps {
  /** Absolute realpath of the symlink target. `null` when the scanner
   *  detected a symlink but could not resolve it (cycle or error). */
  target: string | null;
}

const DISPLAY_MAX = 60;

/** Mid-ellipsis truncation — keeps the last ~40 chars (the filename end
 *  a developer usually recognises) while shrinking the long directory
 *  prefix. Matches the plan.md §3 "60 chars" threshold. */
export function formatSymlinkTarget(target: string): string {
  if (target.length <= DISPLAY_MAX) return target;
  const keepTail = Math.floor(DISPLAY_MAX * 0.6);
  const keepHead = DISPLAY_MAX - keepTail - 1;
  return `${target.slice(0, keepHead)}…${target.slice(target.length - keepTail)}`;
}

export function SymlinkChip({ target }: SymlinkChipProps) {
  const isResolved = typeof target === "string" && target.length > 0;
  const tooltip = isResolved
    ? `symlinked → ${target}`
    : "symlinked — cycle detected or target unresolved";
  const aria = isResolved
    ? `symlinked from ${target}`
    : "symlinked, target unresolved";

  return (
    <span
      data-testid="symlink-chip"
      role="img"
      aria-label={aria}
      title={tooltip}
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 3,
        color: "var(--text-secondary)",
        flexShrink: 0,
      }}
    >
      <svg
        data-testid="symlink-glyph"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </span>
  );
}
