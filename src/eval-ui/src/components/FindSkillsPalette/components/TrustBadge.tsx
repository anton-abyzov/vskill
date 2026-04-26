// 0741 T-007: Ported from vskill-platform/src/app/components/TrustBadge.tsx.
// `TrustTier` is inline-defined here — no Next.js / @/ alias deps so the
// component is safe to bundle into the eval-ui Vite build.

export type TrustTier = "T0" | "T1" | "T2" | "T3" | "T4";

interface TrustBadgeProps {
  tier: TrustTier;
}

const TRUST_TIERS: Record<
  TrustTier,
  { label: string; cssVar: string }
> = {
  T0: { label: "BLOCKED", cssVar: "var(--trust-t0)" },
  T1: { label: "UNSCANNED", cssVar: "var(--trust-t1)" },
  T2: { label: "BASIC", cssVar: "var(--trust-t2)" },
  T3: { label: "VERIFIED", cssVar: "var(--trust-t3)" },
  T4: { label: "CERTIFIED", cssVar: "var(--trust-t4)" },
};

export default function TrustBadge({ tier }: TrustBadgeProps) {
  const config = TRUST_TIERS[tier] ?? TRUST_TIERS.T1;

  return (
    <span
      data-testid="trust-badge"
      data-tier={tier}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.15rem 0.5rem",
        borderRadius: "4px",
        fontFamily: "var(--font-geist-mono)",
        fontSize: "0.6875rem",
        fontWeight: 600,
        letterSpacing: "0.03em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: config.cssVar,
        backgroundColor: `color-mix(in srgb, ${config.cssVar} 10%, transparent)`,
        border: `1px solid color-mix(in srgb, ${config.cssVar} 25%, transparent)`,
        lineHeight: 1,
        height: "22px",
      }}
    >
      {tier} {config.label}
    </span>
  );
}
