// 0826 — Studio CLI persistent privacy banner.
// Same amber treatment as web platform — non-dismissible by design.

import type { CSSProperties } from "react";
import { StudioLockIcon } from "./PrivateBadge";

export interface PrivateBannerProps {
  tenantName: string;
  extraNote?: string;
}

export function PrivateBanner({ tenantName, extraNote }: PrivateBannerProps) {
  const wrap: CSSProperties = {
    width: "100%",
    backgroundColor: "#FFFBEB",
    borderBottom: "2px solid #F59E0B",
    color: "#78350F",
  };
  const inner: CSSProperties = {
    padding: "10px 18px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSize: "0.8125rem",
    fontWeight: 500,
    lineHeight: 1.4,
  };
  const lockWrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: "5px",
    backgroundColor: "#B45309",
    color: "#FFFFFF",
    flex: "0 0 auto",
  };

  return (
    <div role="banner" aria-live="polite" data-private-banner="true" style={wrap}>
      <div style={inner}>
        <span style={lockWrap}><StudioLockIcon size={14} /></span>
        <span>
          <strong style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "ui-monospace, monospace", fontSize: "0.6875rem", marginRight: "0.5rem" }}>
            Private
          </strong>
          visible to <strong>{tenantName}</strong> members only.
          {extraNote && <span style={{ opacity: 0.85 }}>{" "}— {extraNote}</span>}
        </span>
      </div>
    </div>
  );
}

export default PrivateBanner;
