// ---------------------------------------------------------------------------
// 0778 US-001 — usePlatformHealth.
//
// SWR-cached read of GET /api/platform/health (eval-server proxy of
// verified-skill.com upstream stats + queue health). Used by the studio's
// UpdateBell to switch to an amber state when the upstream pipeline is
// degraded so the author isn't misled by a green "no updates" bell.
//
// 60s TTL is plenty — platform degradation changes on operator-action
// timescales (minutes), not seconds.
// ---------------------------------------------------------------------------

import { useSWR } from "./useSWR";

export interface PlatformHealth {
  degraded: boolean;
  reason: string | null;
  statsAgeMs: number;
  oldestActiveAgeMs: number;
}

export function usePlatformHealth(): {
  data: PlatformHealth | undefined;
  loading: boolean;
} {
  const { data, loading } = useSWR<PlatformHealth>(
    "platform-health",
    async () => {
      const res = await fetch("/api/platform/health");
      if (!res.ok) {
        return {
          degraded: false,
          reason: "platform-unreachable",
          statsAgeMs: 0,
          oldestActiveAgeMs: 0,
        };
      }
      return (await res.json()) as PlatformHealth;
    },
    { ttl: 60_000 },
  );
  return { data, loading };
}
