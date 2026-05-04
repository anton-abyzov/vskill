// 0826 — Studio CLI mirror of the verified-skill.com PrivateBadge.
// Visual contract identical to the web platform so users see the same
// amber lock signal regardless of where they're running Studio.

import type { CSSProperties } from "react";

export interface PrivateBadgeProps {
  tenantName: string;
  variant?: "small" | "inline" | "large";
}

const SIZES = {
  small:  { fontSize: "0.625rem",  padX: "0.4rem",  padY: "0.1rem",  height: "18px", icon: 10, showName: false },
  inline: { fontSize: "0.6875rem", padX: "0.5rem",  padY: "0.15rem", height: "22px", icon: 12, showName: true  },
  large:  { fontSize: "0.8125rem", padX: "0.65rem", padY: "0.25rem", height: "28px", icon: 14, showName: true  },
} as const;

export function StudioLockIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.75" y="7" width="10.5" height="6.75" rx="1.25" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.25" />
      <path d="M5 7V5.25C5 3.59 6.34 2.25 8 2.25C9.66 2.25 11 3.59 11 5.25V7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="10.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function PrivateBadge({ tenantName, variant = "inline" }: PrivateBadgeProps) {
  const s = SIZES[variant];
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: `${s.padY} ${s.padX}`,
    height: s.height,
    borderRadius: "4px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: s.fontSize,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    lineHeight: 1,
    color: "#92400E",          // amber-800
    backgroundColor: "#FFFBEB", // amber-50
    border: "1px solid #FCD34D", // amber-300
  };

  return (
    <span
      role="status"
      aria-label={`Private skill — visible to ${tenantName} members only`}
      style={style}
      data-private="true"
    >
      <StudioLockIcon size={s.icon} />
      <span>Private</span>
      {s.showName && (
        <>
          <span aria-hidden style={{ opacity: 0.55, fontWeight: 500 }}>·</span>
          <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: "0.01em" }}>{tenantName}</span>
        </>
      )}
    </span>
  );
}

export default PrivateBadge;
