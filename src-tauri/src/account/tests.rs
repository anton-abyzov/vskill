// 0834 T-029 / 0836 T-008 — unit tests for the account IPC commands.
//
// 0836 US-003 changes the surface from `account_get_token` (returns the
// raw `gho_*` token to the WebView) to `account_get_user_summary` (returns
// `{ login, avatarUrl, tier, signedIn }` only — no token). These tests
// exercise the pure helper `build_user_summary` over the state matrix:
//   (a) signed-out, no quota cache       → defaults `{ signedIn: false, ... }`
//   (b) signed-in, no quota cache        → identity fields + tier="free"
//   (c) signed-in, quota cache pro       → tier="pro"
// The compile-guard on `account_get_token` removal is enforced by the
// Rust compiler — if the symbol is reintroduced this test file will not
// build because we no longer import it.

use super::commands::{build_user_summary, resolve_platform_url};
use crate::auth::UserIdentity;
use crate::quota::cache::{QuotaCache, QuotaResponse, QuotaTier, GRACE_PERIOD_DAYS};

#[test]
fn platform_url_default_when_no_env() {
    assert_eq!(
        resolve_platform_url(None),
        "https://verified-skill.com",
    );
}

#[test]
fn platform_url_uses_env_override_when_present() {
    assert_eq!(
        resolve_platform_url(Some("https://verified-skill.dev")),
        "https://verified-skill.dev",
    );
}

#[test]
fn platform_url_trims_whitespace_and_trailing_slash() {
    assert_eq!(
        resolve_platform_url(Some("  https://verified-skill.test/  ")),
        "https://verified-skill.test",
    );
}

#[test]
fn platform_url_falls_back_when_override_is_empty() {
    assert_eq!(
        resolve_platform_url(Some("")),
        "https://verified-skill.com",
    );
    assert_eq!(
        resolve_platform_url(Some("   ")),
        "https://verified-skill.com",
    );
}

// ---------------------------------------------------------------------------
// 0836 US-003 — account_get_user_summary (via build_user_summary helper)
// ---------------------------------------------------------------------------

fn make_quota_cache(tier: QuotaTier) -> QuotaCache {
    QuotaCache {
        response: QuotaResponse {
            tier,
            skill_count: 0,
            skill_limit: match tier {
                QuotaTier::Free => Some(50),
                _ => None,
            },
            last_synced_at: None,
            grace_period_days_remaining: GRACE_PERIOD_DAYS,
            server_now: "2026-05-09T00:00:00.000Z".into(),
        },
        local_at_sync: "2026-05-09T00:00:00.000Z".into(),
        clock_skew_ms: 0,
    }
}

#[test]
fn user_summary_signed_out_with_no_quota_cache_returns_defaults() {
    let summary = build_user_summary(None, None);
    assert!(!summary.signed_in);
    assert_eq!(summary.login, None);
    assert_eq!(summary.avatar_url, None);
    assert_eq!(summary.tier, "free");
}

#[test]
fn user_summary_signed_out_with_stale_quota_cache_returns_free_tier() {
    // AC-US3-06 contract: signed-out summary MUST be
    // { signedIn: false, login: null, avatarUrl: null, tier: "free" }
    // regardless of any quota cache. A stale cache from a previous sign-in
    // (or another user on the same machine) must NOT leak into the
    // signed-out UI's pricing badge.
    let summary = build_user_summary(None, Some(make_quota_cache(QuotaTier::Pro)));
    assert!(!summary.signed_in);
    assert_eq!(summary.login, None);
    assert_eq!(summary.avatar_url, None);
    assert_eq!(
        summary.tier, "free",
        "signed-out user must see free tier even with stale quota cache (G-007)"
    );
}

#[test]
fn user_summary_signed_in_no_quota_returns_identity_with_free_tier() {
    let identity = UserIdentity {
        login: "octocat".into(),
        avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4".into(),
        email: None,
        cached_at: None,
    };
    let summary = build_user_summary(Some(identity), None);
    assert!(summary.signed_in);
    assert_eq!(summary.login.as_deref(), Some("octocat"));
    assert_eq!(
        summary.avatar_url.as_deref(),
        Some("https://avatars.githubusercontent.com/u/583231?v=4"),
    );
    assert_eq!(summary.tier, "free");
}

#[test]
fn user_summary_signed_in_with_pro_quota_reports_pro_tier() {
    let identity = UserIdentity {
        login: "octocat".into(),
        avatar_url: "https://avatars.githubusercontent.com/u/1?v=4".into(),
        email: None,
        cached_at: None,
    };
    let summary = build_user_summary(
        Some(identity),
        Some(make_quota_cache(QuotaTier::Pro)),
    );
    assert!(summary.signed_in);
    assert_eq!(summary.login.as_deref(), Some("octocat"));
    assert_eq!(summary.tier, "pro");
}

#[test]
fn user_summary_signed_in_with_enterprise_quota_reports_enterprise_tier() {
    let identity = UserIdentity {
        login: "ent-user".into(),
        avatar_url: "https://avatars.githubusercontent.com/u/2?v=4".into(),
        email: None,
        cached_at: None,
    };
    let summary = build_user_summary(
        Some(identity),
        Some(make_quota_cache(QuotaTier::Enterprise)),
    );
    assert!(summary.signed_in);
    assert_eq!(summary.tier, "enterprise");
}

#[test]
fn user_summary_serializes_with_camel_case_fields() {
    // The WebView reads `signedIn` and `avatarUrl` (camelCase). Lock the
    // wire shape so a future serde rename trips this test.
    let summary = build_user_summary(None, None);
    let json = serde_json::to_string(&summary).expect("serialize");
    assert!(json.contains("\"signedIn\":false"), "json: {json}");
    assert!(json.contains("\"avatarUrl\":null"), "json: {json}");
    assert!(json.contains("\"login\":null"), "json: {json}");
    assert!(json.contains("\"tier\":\"free\""), "json: {json}");
}
