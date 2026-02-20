// ---------------------------------------------------------------------------
// Platform security check — queries external SAST scan results (best-effort)
// ---------------------------------------------------------------------------

const BASE_URL = "https://verified-skill.com";

export interface ProviderResult {
  provider: string;
  status: string; // "PASS" | "FAIL" | "PENDING" | "TIMED_OUT"
  verdict: string | null;
  criticalCount: number;
}

export interface PlatformSecurityResult {
  hasCritical: boolean;
  overallVerdict: string;
  providers: ProviderResult[];
  reportUrl: string;
}

/**
 * Check external SAST scan results from the platform API.
 * Returns null on any network/API error (best-effort, non-fatal).
 */
export async function checkPlatformSecurity(
  skillName: string,
): Promise<PlatformSecurityResult | null> {
  try {
    const url = `${BASE_URL}/api/v1/skills/${encodeURIComponent(skillName)}/security`;
    const res = await fetch(url);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      overallVerdict?: string;
      reportUrl?: string;
      providers?: Array<{
        provider?: string;
        status?: string;
        verdict?: string | null;
        criticalCount?: number;
      }>;
    };

    const providers: ProviderResult[] = (data.providers || []).map((p) => ({
      provider: String(p.provider || ""),
      status: String(p.status || "PENDING"),
      verdict: p.verdict ?? null,
      criticalCount: Number(p.criticalCount ?? 0),
    }));

    const hasCritical = providers.some(
      (p) => p.status === "FAIL" && p.criticalCount > 0,
    );

    return {
      hasCritical,
      overallVerdict: String(data.overallVerdict || "PENDING"),
      providers,
      reportUrl: String(data.reportUrl || ""),
    };
  } catch {
    return null;
  }
}
