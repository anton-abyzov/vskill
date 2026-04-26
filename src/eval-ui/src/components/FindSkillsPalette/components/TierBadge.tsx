// 0741 T-007: Ported from vskill-platform/src/app/components/TierBadge.tsx.
// `CertificationTier` is inline-defined to drop the @/ alias dep.

export type CertificationTier = "VERIFIED" | "CERTIFIED";

type BadgeSize = "sm" | "md" | "lg";

interface TierBadgeProps {
  tier: CertificationTier;
  size?: BadgeSize;
  isTainted?: boolean;
}

const SIZES: Record<BadgeSize, { icon: number; fontSize: string; gap: string; px: string; py: string; height: string; radius: string }> = {
  sm: { icon: 12, fontSize: "0.625rem", gap: "0.25rem", px: "0.375rem", py: "0.125rem", height: "18px", radius: "3px" },
  md: { icon: 14, fontSize: "0.6875rem", gap: "0.3rem", px: "0.5rem", py: "0.15rem", height: "22px", radius: "4px" },
  lg: { icon: 16, fontSize: "0.75rem", gap: "0.375rem", px: "0.625rem", py: "0.2rem", height: "26px", radius: "4px" },
};

function VerifiedIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10 1L3 4.5V9.5C3 13.64 5.99 17.52 10 18.5C14.01 17.52 17 13.64 17 9.5V4.5L10 1Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10.5L9.5 12.5L13 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function CertifiedIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10 1L11.9 4.1L15.5 3.5L14.2 7L17 9.5L14.2 12L15.5 15.5L11.9 14.9L10 18L8.1 14.9L4.5 15.5L5.8 12L3 9.5L5.8 7L4.5 3.5L8.1 4.1L10 1Z"
        fill="currentColor"
        fillOpacity="0.15"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M10 6.5L10.9 8.6L13.1 8.8L11.4 10.3L11.9 12.5L10 11.3L8.1 12.5L8.6 10.3L6.9 8.8L9.1 8.6L10 6.5Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const TIER_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  VERIFIED: { color: "var(--tier-verified)", bg: "var(--tier-verified-bg)", border: "var(--tier-verified-border)" },
  CERTIFIED:{ color: "var(--tier-certified)", bg: "var(--tier-certified-bg)", border: "var(--tier-certified-border)" },
  TAINTED:  { color: "var(--tier-tainted)", bg: "var(--tier-tainted-bg)", border: "var(--tier-tainted-border)" },
};

// Display labels — CERTIFIED == "trusted publisher, scanning bypassed";
// VERIFIED == "passed our security scans". Mirror platform 0744 labels.
const TIER_LABELS: Record<string, string> = {
  VERIFIED: "Security-Scanned",
  CERTIFIED: "Trusted Publisher",
  TAINTED: "Tainted",
};

export function formatTierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

function TaintedIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 2L1.5 17.5H18.5L10 2Z" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M10 8V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="1" fill="currentColor" />
    </svg>
  );
}

function TierIcon({ tier, size }: { tier: string; size: number }) {
  if (tier === "TAINTED") return <TaintedIcon size={size} />;
  if (tier === "CERTIFIED") return <CertifiedIcon size={size} />;
  return <VerifiedIcon size={size} />;
}

export default function TierBadge({ tier, size = "md", isTainted }: TierBadgeProps) {
  const s = SIZES[size];
  const displayTier = isTainted ? "TAINTED" : tier;
  const style = TIER_STYLES[displayTier] ?? TIER_STYLES.VERIFIED;

  return (
    <span
      data-testid="tier-badge"
      data-tier={displayTier}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        padding: `${s.py} ${s.px}`,
        height: s.height,
        borderRadius: s.radius,
        fontFamily: "var(--font-geist-mono)",
        fontSize: s.fontSize,
        fontWeight: 600,
        letterSpacing: "0.03em",
        whiteSpace: "nowrap",
        color: style.color,
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        lineHeight: 1,
      }}
    >
      <TierIcon tier={displayTier} size={s.icon} />
      {formatTierLabel(displayTier)}
    </span>
  );
}
