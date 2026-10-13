import type { QuotaResponse, QuotaSnapshot } from "./preferences/lib/useDesktopBridge";

/** Same-origin proxy reads live entitlement with the platform token on the
 * server. Neither browser nor desktop needs a GitHub credential for billing. */
export async function readPlatformQuota(fresh = false, localSkillCount = 0): Promise<QuotaSnapshot> {
  const response = await fetch(`/api/v1/billing/quota${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
  if (!response.ok) {
    throw Object.assign(new Error(`Could not read subscription status (${response.status}).`), { status: response.status });
  }
  const quota = await response.json() as QuotaResponse;
  if (!["free", "pro", "enterprise"].includes(quota.tier)) throw new Error("Invalid subscription response");
  const localAtSync = new Date().toISOString();
  return {
    cache: { response: quota, localAtSync, clockSkewMs: 0 },
    localSkillCount,
    isFresh: true,
    daysRemaining: quota.gracePeriodDaysRemaining ?? 0,
  };
}
