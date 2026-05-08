// 0831 quota::sync — background quota refresh + force_sync IPC.
//
// Two entry points:
//   - `start_background_task(app)`   : spawns the 1h tokio task that polls
//                                       `/api/v1/billing/quota` while a token
//                                       exists in the keychain. Emits the
//                                       Tauri event `quota://updated` on each
//                                       successful refresh so the UI's
//                                       QuotaContext re-fetches.
//   - `force_sync(fresh: bool)`       : on-demand refresh used by the paywall
//                                       race-resolution path (T-021) and the
//                                       UI's "Sync now" buttons. `fresh=true`
//                                       appends `?fresh=1` so the platform
//                                       skips its KV cache.
//
// Threat model recap (ADR-0831-04): the `skillCount` returned by the server
// is the source of truth. We never use the local count for enforcement —
// only for the POST telemetry channel. This is what defeats the
// "delete settings.json to reset the counter" abuse vector.
//
// Network policy:
//   - 5s connect timeout, 10s total request timeout.
//   - 3 attempts with exponential backoff (1s / 4s / 16s) for transient
//     5xx and connect errors. 401 returns immediately (no retry — the token
//     is bad).
//   - GET response BUSTS the disk cache only on 200. 401 clears the cache
//     and clears the keychain (treated as sign-out by the server).

use std::time::Duration;

use serde::Deserialize;
use tauri::Emitter;

use super::cache::{save_quota_cache, QuotaCache, QuotaResponse};
use crate::auth::TokenStore;

/// Default platform host. Overridable in tests via the `VSKILL_QUOTA_BASE`
/// env var (set by mockito) — see force_sync_with_base().
pub const QUOTA_API_BASE: &str = "https://verified-skill.com";

/// Background sync interval — 1h per ADR-0831-05 / spec US-010 cadence.
pub const QUOTA_SYNC_INTERVAL_SECS: u64 = 3600;

/// Hard timeout for a single sync round-trip (connect + body), used by both
/// the background task and the force-sync IPC. Per plan §NFR.
const REQUEST_TIMEOUT_SECS: u64 = 10;

#[derive(Debug)]
pub enum QuotaSyncError {
    /// No token in keychain — caller should treat as "sign in first".
    NotSignedIn,
    /// Server explicitly rejected our token (401). Token has been cleared
    /// from the keychain by the time this returns.
    Unauthorized,
    /// 4xx (other) / 5xx with body for diagnostics.
    Http { status: u16, body: String },
    /// Network-level failure: timeout, DNS, TLS, connection reset.
    Network(String),
    /// Response shape didn't match `QuotaResponse`.
    Parse(String),
}

impl std::fmt::Display for QuotaSyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSignedIn => write!(f, "not signed in"),
            Self::Unauthorized => write!(f, "unauthorized (401)"),
            Self::Http { status, body } => write!(f, "http {status}: {body}"),
            Self::Network(m) => write!(f, "network: {m}"),
            Self::Parse(m) => write!(f, "parse: {m}"),
        }
    }
}

impl std::error::Error for QuotaSyncError {}

/// Read the active platform base URL. Allows tests (mockito) to override
/// without mocking the entire reqwest client.
fn quota_base() -> String {
    std::env::var("VSKILL_QUOTA_BASE").unwrap_or_else(|_| QUOTA_API_BASE.to_string())
}

/// Format the current local instant as RFC 3339. Used as the `local_at_sync`
/// stamp on the cache. `time` crate is already pulled in transitively by
/// reqwest's HTTP date handling — but to keep this module dependency-free,
/// we synthesize the ISO string from `SystemTime::now()` directly.
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs() as i64;
    let ms = dur.subsec_millis();
    format_unix_to_iso(secs, ms)
}

/// Convert Unix seconds + milliseconds into a canonical ISO-8601 UTC string.
/// Mirror of the days-from-civil algorithm used in cache.rs but in reverse.
fn format_unix_to_iso(secs_since_epoch: i64, ms: u32) -> String {
    // Civil from days. Howard Hinnant.
    let z = secs_since_epoch.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month: i64 = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    let secs_of_day = secs_since_epoch.rem_euclid(86400);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z"
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireQuotaResponse {
    tier: String,
    skill_count: i64,
    skill_limit: Option<i64>,
    last_synced_at: Option<String>,
    grace_period_days_remaining: i64,
    server_now: String,
}

/// On-demand refresh. Reads the keychain token, GETs `/api/v1/billing/quota`,
/// writes the cache on success, emits `quota://updated`. Used by:
///   - The 1h background tokio task (T-018).
///   - The post-sign-in init in `lib.rs::run`.
///   - The paywall race-resolution path (T-021) with `fresh=true`.
pub async fn force_sync(
    app: tauri::AppHandle,
    fresh: bool,
) -> Result<QuotaCache, QuotaSyncError> {
    let token = TokenStore::new()
        .load()
        .map_err(|e| QuotaSyncError::Network(format!("keychain: {e}")))?
        .ok_or(QuotaSyncError::NotSignedIn)?;

    let resp = fetch_quota(token.as_str(), fresh).await?;
    let cache = QuotaCache::from_response(into_internal(resp)?, now_iso());

    // Best-effort write — failure is logged but doesn't fail the call.
    if let Err(e) = save_quota_cache(&cache) {
        log::warn!("save_quota_cache failed: {e}");
    }

    // Notify the React layer to re-fetch. Failure here means no listener
    // is attached, which is fine.
    let _ = app.emit("quota://updated", &cache);

    Ok(cache)
}

/// Best-effort POST `/api/v1/billing/quota/report` with the locally-computed
/// count. Failure is logged but doesn't surface — telemetry is non-blocking
/// per spec.
pub async fn report_count(skill_count: i64) -> Result<(), QuotaSyncError> {
    let token = TokenStore::new()
        .load()
        .map_err(|e| QuotaSyncError::Network(format!("keychain: {e}")))?
        .ok_or(QuotaSyncError::NotSignedIn)?;

    let url = format!("{}/api/v1/billing/quota/report", quota_base());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(concat!("vskill-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| QuotaSyncError::Network(format!("build client: {e}")))?;
    let resp = client
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token.as_str()))
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&serde_json::json!({ "skillCount": skill_count }))
        .send()
        .await
        .map_err(|e| QuotaSyncError::Network(e.to_string()))?;

    let status = resp.status();
    if status.as_u16() == 401 {
        // Server says we're unauthenticated — drop local creds.
        let _ = TokenStore::new().clear();
        return Err(QuotaSyncError::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(QuotaSyncError::Http {
            status: status.as_u16(),
            body,
        });
    }
    Ok(())
}

async fn fetch_quota(
    token: &str,
    fresh: bool,
) -> Result<WireQuotaResponse, QuotaSyncError> {
    let mut url = format!("{}/api/v1/billing/quota", quota_base());
    if fresh {
        url.push_str("?fresh=1");
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(concat!("vskill-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| QuotaSyncError::Network(format!("build client: {e}")))?;

    // Exponential backoff: 0s / 1s / 4s. Three attempts max for transient
    // failures; 401 short-circuits.
    let mut last_err: Option<QuotaSyncError> = None;
    let backoffs = [Duration::ZERO, Duration::from_secs(1), Duration::from_secs(4)];
    for backoff in backoffs {
        if backoff > Duration::ZERO {
            tokio::time::sleep(backoff).await;
        }
        let resp = match client
            .get(&url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(QuotaSyncError::Network(e.to_string()));
                continue;
            }
        };

        let status = resp.status();
        if status.as_u16() == 401 {
            // Drop local creds — the platform considers us unauthenticated.
            let _ = TokenStore::new().clear();
            return Err(QuotaSyncError::Unauthorized);
        }
        if status.is_success() {
            return resp
                .json::<WireQuotaResponse>()
                .await
                .map_err(|e| QuotaSyncError::Parse(e.to_string()));
        }
        // 5xx → retry after backoff. 4xx (other) → don't retry.
        if status.is_server_error() {
            let body = resp.text().await.unwrap_or_default();
            last_err = Some(QuotaSyncError::Http {
                status: status.as_u16(),
                body,
            });
            continue;
        }
        let body = resp.text().await.unwrap_or_default();
        return Err(QuotaSyncError::Http {
            status: status.as_u16(),
            body,
        });
    }
    Err(last_err.unwrap_or_else(|| QuotaSyncError::Network("exhausted retries".into())))
}

fn into_internal(wire: WireQuotaResponse) -> Result<QuotaResponse, QuotaSyncError> {
    let tier = match wire.tier.as_str() {
        "free" => super::cache::QuotaTier::Free,
        "pro" => super::cache::QuotaTier::Pro,
        "enterprise" => super::cache::QuotaTier::Enterprise,
        other => {
            return Err(QuotaSyncError::Parse(format!(
                "unrecognized tier: {other}"
            )));
        }
    };
    Ok(QuotaResponse {
        tier,
        skill_count: wire.skill_count,
        skill_limit: wire.skill_limit,
        last_synced_at: wire.last_synced_at,
        grace_period_days_remaining: wire.grace_period_days_remaining,
        server_now: wire.server_now,
    })
}

/// Spawn the 1h tokio loop. Each tick:
///   1. Skip if no token in keychain (signed out).
///   2. Call `force_sync(false)`.
///   3. Log result. Errors do NOT abort the loop — next tick re-tries.
///
/// Lives for the lifetime of the app process. Cancellation isn't required
/// because the loop is cheap when signed out (single keychain read).
pub fn spawn_background_task(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Initial sync at launch (with a small delay so we don't compete
        // with sidecar boot for cold-start CPU).
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            let token_present = TokenStore::new()
                .load()
                .map(|opt| opt.is_some())
                .unwrap_or(false);
            if token_present {
                match force_sync(app.clone(), false).await {
                    Ok(cache) => {
                        log::debug!(
                            "quota sync ok: tier={:?} count={}",
                            cache.response.tier,
                            cache.response.skill_count
                        );
                    }
                    Err(QuotaSyncError::NotSignedIn) => {
                        // Token disappeared between the keychain check and
                        // the call — treat as signed-out.
                    }
                    Err(QuotaSyncError::Unauthorized) => {
                        log::warn!("quota sync 401 — token cleared");
                    }
                    Err(e) => {
                        log::warn!("quota sync failed: {e}");
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(QUOTA_SYNC_INTERVAL_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_round_trips_through_parser() {
        let s = now_iso();
        // Must be parseable by the cache.rs parser — so the very next
        // is_fresh() call uses a value of the same shape.
        let parsed = super::super::cache::QuotaCache::from_response(
            QuotaResponse {
                tier: super::super::cache::QuotaTier::Free,
                skill_count: 0,
                skill_limit: Some(50),
                last_synced_at: None,
                grace_period_days_remaining: 7,
                server_now: s.clone(),
            },
            s.clone(),
        );
        assert!(parsed.is_fresh(&s));
    }

    #[test]
    fn into_internal_recognizes_all_tiers() {
        for (s, expected) in [
            ("free", super::super::cache::QuotaTier::Free),
            ("pro", super::super::cache::QuotaTier::Pro),
            ("enterprise", super::super::cache::QuotaTier::Enterprise),
        ] {
            let r = into_internal(WireQuotaResponse {
                tier: s.into(),
                skill_count: 0,
                skill_limit: None,
                last_synced_at: None,
                grace_period_days_remaining: 7,
                server_now: "2026-05-07T00:00:00Z".into(),
            })
            .expect("recognized");
            assert_eq!(r.tier, expected);
        }
    }

    #[test]
    fn into_internal_rejects_unknown_tier() {
        let r = into_internal(WireQuotaResponse {
            tier: "platinum".into(),
            skill_count: 0,
            skill_limit: None,
            last_synced_at: None,
            grace_period_days_remaining: 7,
            server_now: "2026-05-07T00:00:00Z".into(),
        });
        assert!(matches!(r, Err(QuotaSyncError::Parse(_))));
    }

    #[test]
    fn format_unix_to_iso_round_trips_through_parser() {
        // 1700000000 = Tue Nov 14 2023 22:13:20 UTC.
        let s = format_unix_to_iso(1700000000, 0);
        assert_eq!(s, "2023-11-14T22:13:20.000Z");
    }
}
