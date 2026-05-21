/**
 * 0848 — Tiny inline lock chip for SkillRow / MarketplaceDrawer entries
 * whose source repo is a private GitHub repo. Pairs with the larger
 * PrivateBadge (org-scope detail views) but uses minimal vertical real-estate
 * so it slots into the existing 36px SkillRow without changing its height.
 *
 * Color: amber (consistent with PrivateBadge / PrivateOrgSection). Green or
 * blue would imply "safe public" — exactly the wrong signal for private.
 */
import type { CSSProperties } from "react";

import { StudioLockIcon } from "./private/PrivateBadge";

export interface PrivateRepoChipProps {
  /** "owner/name" shown in the tooltip when present. */
  repoFullName?: string | null;
  /** Style variant: "row" = 14x14 lock + 1px border; "tag" = same + "Private" label. */
  variant?: "row" | "tag";
}

export function PrivateRepoChip({
  repoFullName,
  variant = "row",
}: PrivateRepoChipProps): JSX.Element {
  const tooltip = repoFullName
    ? `From private repo: ${repoFullName}`
    : "From a private repo";

  const baseStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: variant === "tag" ? 4 : 0,
    height: 18,
    padding: variant === "tag" ? "0 6px" : "0 3px",
    borderRadius: 4,
    color: "var(--private-fg, #92400e)",
    backgroundColor: "var(--private-bg, rgba(245,158,11,0.12))",
    border: "1px solid var(--private-border-soft, rgba(245,158,11,0.35))",
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    lineHeight: 1,
    flexShrink: 0,
  };

  return (
    <span
      role="status"
      aria-label={tooltip}
      title={tooltip}
      data-testid="skill-row-private-chip"
      data-private="true"
      data-variant={variant}
      style={baseStyle}
    >
      <StudioLockIcon size={11} />
      {variant === "tag" ? <span>Private</span> : null}
    </span>
  );
}

export default PrivateRepoChip;
