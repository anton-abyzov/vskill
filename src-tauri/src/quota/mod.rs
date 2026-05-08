// 0831 quota — server-authoritative quota cache + background sync (T-017..T-021).
//
// Module layout:
//   - cache  : disk-backed cache (~/.vskill/cache/quota.json) with serverNow
//              based freshness window per ADR-0831-05.
//   - sync   : 1h background tokio task + on-demand force_sync IPC. Fetches
//              `GET /api/v1/billing/quota` from verified-skill.com using the
//              OAuth token from `auth::TokenStore`. Reports local count via
//              `POST /api/v1/billing/quota/report` for telemetry.
//   - count  : walks open project roots + ~/.claude/skills/ to compute the
//              local skill count. Deduplicated by (name@version).
//
// Threat model recap (ADR-0831-04): the desktop computes its own count for
// telemetry but the SERVER's `skillCount` from /api/v1/billing/quota is the
// enforcement source. Deleting ~/.vskill/cache/quota.json doesn't reset the
// server's view; the next sync simply re-stamps the cache from the server.
//
// Offline grace (ADR-0831-05): freshness is `serverNow + GRACE_PERIOD_DAYS`,
// not `cachedAt + GRACE_PERIOD_DAYS`. We trust the server clock and store
// `clock_skew_ms` so all subsequent now() comparisons are skew-adjusted.

pub mod cache;
pub mod count;
pub mod sync;

#[allow(unused_imports)]
pub use cache::{
    clear_quota_cache, load_quota_cache, save_quota_cache, QuotaCache, QuotaCacheError,
    QuotaResponse, QuotaTier,
};
#[allow(unused_imports)]
pub use count::{count_local_skills, SkillCountError};
#[allow(unused_imports)]
pub use sync::{force_sync, QuotaSyncError, QUOTA_API_BASE, QUOTA_SYNC_INTERVAL_SECS};

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test that the module re-exports compile. Richer suites live in
    /// each submodule.
    #[test]
    fn reexports_resolve() {
        let _: &str = QUOTA_API_BASE;
        let _ = QuotaTier::Free;
    }
}
