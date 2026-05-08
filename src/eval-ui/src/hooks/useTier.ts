// 0831 — useTier: tier-aware feature gate hook (US-008).
//
// Owner: desktop-quota-agent.
//
// Thin derived view over `useQuota()`. UI components consuming tier gates
// (PrivateRepoConnect button, ProChip, paywall trigger) call useTier()
// and switch on the booleans without ever touching the raw QuotaContext.
//
// Returned shape mirrors what the spec calls out (US-008 AC-US8-05):
//   { tier, isPro, isFree, skillCount, skillLimit, gracePeriodDaysRemaining }
//
// Behavior on signed-out / no-cache state: returns `tier: "free"` —
// failing CLOSED is intentional. The UI shows tier-locked gates rather
// than letting a clean install bypass enforcement. The only escape hatch
// is signing in (which triggers force_sync and resolves the real tier).

import { useQuota } from "../contexts/QuotaContext";

import type { QuotaTierWire } from "../preferences/lib/useDesktopBridge";

export interface UseTierResult {
  /** "free" | "pro" | "enterprise". Defaults to "free" when no cache. */
  tier: QuotaTierWire;
  /** Convenience: tier === "pro" || tier === "enterprise". */
  isPro: boolean;
  /** Convenience: tier === "free". */
  isFree: boolean;
  /** Convenience: tier === "enterprise" specifically. */
  isEnterprise: boolean;
  /** Server-side authoritative count, or 0 when no cache. */
  skillCount: number;
  /**
   * Server-side cap — `null` for unlimited (pro/enterprise).
   * Defaults to `50` (free-tier limit) when no cache.
   */
  skillLimit: number | null;
  /** Days left in the offline-grace window. Negative when stale. */
  gracePeriodDaysRemaining: number;
  /** Whether the cache is fresh (within grace). */
  isFresh: boolean;
  /** True if the snapshot has loaded at least once (false on first render). */
  loaded: boolean;
  /** Locally-counted skill total — informational, not enforcement. */
  localSkillCount: number;
}

const FREE_TIER_LIMIT_DEFAULT = 50;

export function useTier(): UseTierResult {
  const { snapshot } = useQuota();

  if (!snapshot) {
    return {
      tier: "free",
      isPro: false,
      isFree: true,
      isEnterprise: false,
      skillCount: 0,
      skillLimit: FREE_TIER_LIMIT_DEFAULT,
      gracePeriodDaysRemaining: 0,
      isFresh: false,
      loaded: false,
      localSkillCount: 0,
    };
  }

  const cache = snapshot.cache;
  if (!cache) {
    // No cache yet — fail-closed to free.
    return {
      tier: "free",
      isPro: false,
      isFree: true,
      isEnterprise: false,
      skillCount: 0,
      skillLimit: FREE_TIER_LIMIT_DEFAULT,
      gracePeriodDaysRemaining: snapshot.daysRemaining,
      isFresh: snapshot.isFresh,
      loaded: true,
      localSkillCount: snapshot.localSkillCount,
    };
  }

  const tier = cache.response.tier;
  const isPro = tier === "pro" || tier === "enterprise";
  return {
    tier,
    isPro,
    isFree: tier === "free",
    isEnterprise: tier === "enterprise",
    skillCount: cache.response.skillCount,
    skillLimit: cache.response.skillLimit,
    gracePeriodDaysRemaining: snapshot.daysRemaining,
    isFresh: snapshot.isFresh,
    loaded: true,
    localSkillCount: snapshot.localSkillCount,
  };
}

/**
 * Centralized pricing URL — single source of truth so all upgrade buttons
 * point at the same target. Per AC-US8-03.
 */
export const PRICING_URL = "https://verified-skill.com/pricing";

/**
 * Centralized GitHub App install URL. Per AC-US7-02.
 *
 * The platform's `/api/v1/auth/github/installation/init` route is the
 * canonical entry — it sets a CSRF state cookie before redirecting to
 * github.com/apps/verified-skill/installations/new. Calling it directly
 * keeps the flow consistent for both desktop and web.
 */
export const GITHUB_APP_INSTALL_URL =
  "https://verified-skill.com/api/v1/auth/github/installation/init";

/**
 * Tier-feature lookup. UI components consume this via `featureRequiresPaid`.
 * Adding a new gate is a single-file edit per AC-US8-05.
 */
export const TIER_FEATURES = {
  "private-repos": ["pro", "enterprise"] as QuotaTierWire[],
  "github-app": ["pro", "enterprise"] as QuotaTierWire[],
  "unlimited-skills": ["pro", "enterprise"] as QuotaTierWire[],
} as const;

export type TierFeature = keyof typeof TIER_FEATURES;

export function featureAllowsTier(
  feature: TierFeature,
  tier: QuotaTierWire,
): boolean {
  return (TIER_FEATURES[feature] as ReadonlyArray<QuotaTierWire>).includes(tier);
}
