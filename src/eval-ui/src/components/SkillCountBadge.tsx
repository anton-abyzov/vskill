// 0843 US-002 — SkillCountBadge: small status-bar badge showing the user's
// skill quota at a glance.
//
// Free tier:           "N / 50"   (lock glyph, tooltip explains the cap)
// Pro / Enterprise:    "N skills" (sparkle glyph, tooltip mentions unlimited)
// Signed-out:          falls back to "0 / 50" so layout is stable; clicking
//                      the badge surfaces the existing /account route via
//                      the studio:open-account-tab event (handled in App.tsx).
//
// Inline SVG icons here are intentional (one place, easy diff). T-005 swaps
// them for Lucide equivalents when the dep lands.

import { useAccountSummary } from "../hooks/useAccountSummary";
import { useTier } from "../hooks/useTier";

const FREE_CAP_FALLBACK = 50;

const FREE_TOOLTIP = "Free tier: 50 skills. Click to upgrade.";
const UNLIMITED_TOOLTIP = (tier: "pro" | "enterprise") =>
  tier === "pro"
    ? "Pro tier: unlimited skills."
    : "Enterprise tier: unlimited skills.";

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      aria-hidden="true"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

export function SkillCountBadge() {
  const { signedIn } = useAccountSummary();
  const { tier, skillCount, skillLimit, isUnlimited } = useTier();

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontFamily: "var(--font-sans)",
    color: "var(--text-secondary)",
    padding: "2px 6px",
    border: "1px solid var(--border-default)",
    borderRadius: 4,
    fontVariantNumeric: "tabular-nums",
  };

  if (!signedIn) {
    return (
      <span
        data-testid="skill-count-badge"
        data-state="signed-out"
        title={FREE_TOOLTIP}
        style={baseStyle}
      >
        <LockIcon />
        {`0 / ${FREE_CAP_FALLBACK}`}
      </span>
    );
  }

  if (tier === "free") {
    const cap = skillLimit ?? FREE_CAP_FALLBACK;
    return (
      <span
        data-testid="skill-count-badge"
        data-state="free"
        title={FREE_TOOLTIP}
        style={baseStyle}
      >
        <LockIcon />
        {`${skillCount} / ${cap}`}
      </span>
    );
  }

  // pro | enterprise — both unlimited per useTier output (skillLimit === null)
  void isUnlimited; // intentional read so future contract regression flags here.
  return (
    <span
      data-testid="skill-count-badge"
      data-state={tier}
      title={UNLIMITED_TOOLTIP(tier)}
      style={baseStyle}
    >
      <SparklesIcon />
      {`${skillCount} skills`}
    </span>
  );
}
