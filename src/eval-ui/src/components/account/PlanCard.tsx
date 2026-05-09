// 0834 T-025 — PlanCard.
//
// Rendering-pure summary of the user's current tier with an "Active" chip,
// a "what's included" bulleted list, and an Upgrade CTA. The host wires
// the CTA href; the component never knows about /pricing directly. Used
// by /account/billing and the desktop AccountShell's billing tab.
//
// AC-US4-03.

import type { UserTierWire } from "../../types/account";

export interface PlanCardProps {
  tier: UserTierWire;
  /** Optional override for the upgrade CTA target — defaults disabled. */
  onUpgradeClick?: () => void;
  /**
   * When false, hide the Upgrade CTA (desktop signed-out preview, or
   * enterprise where upgrade isn't a self-serve action). Defaults true.
   */
  showUpgradeCta?: boolean;
}

interface TierMeta {
  label: string;
  badge: string;
  bullets: ReadonlyArray<string>;
  upgradeLabel: string | null;
}

const TIER_META: Record<UserTierWire, TierMeta> = {
  free: {
    label: "Free",
    badge: "Open Source · MIT",
    bullets: [
      "Unlimited public skills",
      "Public GitHub repo connections",
      "Community support",
    ],
    upgradeLabel: "Upgrade to Pro",
  },
  pro: {
    label: "Pro",
    badge: "Active",
    bullets: [
      "Hosted private skill storage",
      "Connect private GitHub repos",
      "Sync skills automatically",
      "Priority email support",
    ],
    upgradeLabel: "Talk to sales about Enterprise",
  },
  enterprise: {
    label: "Enterprise",
    badge: "Active",
    bullets: [
      "Everything in Pro",
      "SSO + audit log",
      "Dedicated support",
      "Custom contract",
    ],
    upgradeLabel: null,
  },
};

export function PlanCard({
  tier,
  onUpgradeClick,
  showUpgradeCta = true,
}: PlanCardProps) {
  const meta = TIER_META[tier];

  return (
    <div
      data-testid={`plan-card-${tier}`}
      style={{
        padding: 20,
        border: "1px solid var(--border-default, #e5e7eb)",
        borderRadius: 10,
        background: "var(--bg-elevated, #fff)",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            {meta.label}
          </h3>
          <span
            data-testid="plan-card-badge"
            style={{
              padding: "2px 10px",
              fontSize: 11,
              fontWeight: 500,
              background:
                tier === "free"
                  ? "rgba(37, 99, 235, 0.1)"
                  : "rgba(22, 163, 74, 0.1)",
              color: tier === "free" ? "#1d4ed8" : "#15803d",
              borderRadius: 999,
            }}
          >
            {meta.badge}
          </span>
        </div>
      </div>

      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: "var(--text-secondary)",
            marginBottom: 6,
          }}
        >
          What's included
        </div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 13,
            color: "var(--text-primary)",
          }}
        >
          {meta.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </div>

      {showUpgradeCta && meta.upgradeLabel && (
        <div>
          <button
            type="button"
            data-testid="plan-card-upgrade"
            onClick={onUpgradeClick}
            disabled={!onUpgradeClick}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "inherit",
              background: onUpgradeClick
                ? "var(--color-accent, #2563eb)"
                : "var(--bg-canvas, #f3f4f6)",
              color: onUpgradeClick
                ? "#fff"
                : "var(--text-tertiary, #9ca3af)",
              border: `1px solid ${
                onUpgradeClick
                  ? "var(--color-accent, #2563eb)"
                  : "var(--border-default, #e5e7eb)"
              }`,
              borderRadius: 6,
              cursor: onUpgradeClick ? "pointer" : "not-allowed",
            }}
          >
            {meta.upgradeLabel}
          </button>
        </div>
      )}
    </div>
  );
}
