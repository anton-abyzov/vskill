// ---------------------------------------------------------------------------
// 0698 T-008: GroupHeader
//
// Small-caps non-collapsible header used to label the top-level sidebar
// groups (AVAILABLE / AUTHORING). Renders a visually-quiet label and a count
// badge; always shows the count even when zero so users know the section
// exists.
//
// No interaction — deliberately not collapsible. Collapse belongs to the
// sub-sections (ScopeSection).
// ---------------------------------------------------------------------------

import * as React from "react";

export interface GroupHeaderProps {
  /** Display label, e.g. "AVAILABLE" or "AUTHORING" (rendered as-is, no case transform). */
  name: string;
  /** Total skills in this group; always shown — including zero. */
  count: number;
  /** Optional extra class — composes with the default styles. */
  className?: string;
}

export function GroupHeader({ name, count, className }: GroupHeaderProps): React.ReactElement {
  const cls = [
    "flex items-center gap-1 px-2 py-1 text-xs uppercase tracking-wide font-medium text-muted-foreground select-none",
    className ?? "",
  ].join(" ").trim();

  return (
    <div data-vskill-group-header={name} className={cls} role="heading" aria-level={3}>
      <span className="vskill-group-header-name">{name}</span>
      <span className="vskill-group-header-count tabular-nums">({count})</span>
    </div>
  );
}
