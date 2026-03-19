// ---------------------------------------------------------------------------
// Platform security check — queries external SAST scan results (best-effort)
// ---------------------------------------------------------------------------

const BASE_URL = "https://verified-skill.com";

export interface ProviderResult {
  provider: string;
  status: "PASS" | "FAIL" | "PENDING" | "TIMED_OUT";
  verdict: "PASS" | "FAIL" | "CONCERNS" | "PENDING" | null;
  criticalCount: number;
}

export interface PlatformSecurityResult {
  hasCritical: boolean;
  overallVerdict: "PASS" | "FAIL" | "PENDING" | "TIMED_OUT" | "CERTIFIED";
  providers: ProviderResult[];
  reportUrl: string;
}

// ---------------------------------------------------------------------------
// Runtime validation helpers
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<ProviderResult["status"]>(["PASS", "FAIL", "PENDING", "TIMED_OUT"]);
const VALID_VERDICTS = new Set<NonNullable<ProviderResult["verdict"]>>(["PASS", "FAIL", "CONCERNS", "PENDING"]);
const VALID_OVERALL = new Set<PlatformSecurityResult["overallVerdict"]>(["PASS", "FAIL", "PENDING", "TIMED_OUT", "CERTIFIED"]);

function validateEnum<T extends string>(value: string, allowed: Set<T>, fallback: T): T {
  const upper = value.toUpperCase() as T;
  return allowed.has(upper) ? upper : fallback;
}

function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return isNaN(n) ? fallback : n;
}

/**
 * Check external SAST scan results from the platform API.
 * Returns null on any network/API error (best-effort, non-fatal).
 */
export async function checkPlatformSecurity(
  skillName: string,
): Promise<PlatformSecurityResult | null> {
  try {
    const url = `${BASE_URL}/api/v1/skills/${skillName.split("/").map(encodeURIComponent).join("/")}/security`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });

    if (!res.ok) {
      console.warn(`[platform-security] HTTP ${res.status} for ${skillName}`);
      return null;
    }

    const data = (await res.json()) as {
      overallVerdict?: string;
      reportUrl?: string;
      providers?: Array<{
        provider?: string;
        status?: string;
        verdict?: string | null;
        criticalCount?: unknown;
      }>;
    };

    const providers: ProviderResult[] = (data.providers || []).map((p) => ({
      provider: String(p.provider || ""),
      status: validateEnum(String(p.status || "PENDING"), VALID_STATUSES, "PENDING"),
      verdict: p.verdict == null ? null : validateEnum(String(p.verdict), VALID_VERDICTS, "PENDING"),
      criticalCount: safeNumber(p.criticalCount, 0),
    }));

    // Empty providers = no scan data available — report as PENDING, not all-clear
    const overallVerdict = providers.length === 0
      ? "PENDING" as const
      : validateEnum(String(data.overallVerdict || "PENDING"), VALID_OVERALL, "PENDING");

    const hasCritical = providers.some(
      (p) => p.status === "FAIL" && p.criticalCount > 0,
    );

    return {
      hasCritical,
      overallVerdict,
      providers,
      reportUrl: String(data.reportUrl || ""),
    };
  } catch (err) {
    console.warn(`[platform-security] check failed for ${skillName}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}
