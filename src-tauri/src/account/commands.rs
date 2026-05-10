// 0834 T-029 / 0836 US-003 — Tauri IPC commands for the /account WebView.
//
// 0836 US-003 SECURITY CHANGE
// ---------------------------
// `account_get_token` is REMOVED. The IPC previously returned the raw
// `gho_*` GitHub OAuth token to the WebView so AccountContext could mint
// `Authorization: Bearer …` headers. That made any reachable XSS or
// compromised npm dep one `invoke('account_get_token')` away from
// exfiltrating the user's GitHub access. We now keep the token Rust-side
// only — every authenticated /api/v1/private|tenants/* request goes
// through the eval-server's platform-proxy, which injects the bearer
// from the keychain on the proxy side (see `src/eval-server/platform-proxy.ts`).
//
// Replacement IPC: `account_get_user_summary` returns just the display
// fields the WebView legitimately needs:
//   - signedIn: bool
//   - login:    Option<String> (GitHub login)
//   - avatarUrl: Option<String> (avatar URL)
//   - tier:     "free" | "pro" | "enterprise"
//
// `account_get_platform_url` is unchanged.

use serde::Serialize;

/// Default platform origin. Env override:
///   VSKILL_PLATFORM_URL=https://verified-skill.dev npm run desktop:dev
const DEFAULT_PLATFORM_URL: &str = "https://verified-skill.com";
const PLATFORM_URL_ENV: &str = "VSKILL_PLATFORM_URL";

/// IPC payload for `account_get_user_summary`. The shape is frozen so the
/// React layer (AccountContext + AccountTauriBridge) can read it without a
/// typed bridge schema. Field names are camelCase on the wire because the
/// WebView consumes JSON, not snake_case Rust.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountUserSummary {
    /// Whether the user has a cached identity (a successful sign-in has
    /// happened in the past and the cache file is present).
    pub signed_in: bool,
    /// GitHub login (e.g. "octocat"). `None` when signed-out.
    pub login: Option<String>,
    /// Avatar URL. `None` when signed-out.
    pub avatar_url: Option<String>,
    /// Pricing tier — "free" | "pro" | "enterprise". Lowercase strings on
    /// the wire match `QuotaTierWire` on the platform side.
    pub tier: String,
}

/// 0836 US-003: pure helper that turns the (identity, quota) state pair into
/// the WebView-facing summary. Extracted so cargo tests can exercise the
/// state matrix without disk / Tauri.
///
/// AC-US3-06 contract: when `identity` is `None`, the returned summary MUST
/// be `{ signedIn: false, login: null, avatarUrl: null, tier: "free" }`
/// regardless of any cached quota state. This prevents stale tier data from
/// a previous sign-in (or another user on the same machine) leaking into
/// the signed-out UI. The quota cache is independently cleared on sign-out
/// (see G-008 fix in `commands::sign_out`), but this guard is the
/// belt-and-suspenders defense in case clear_quota_cache() ever fails.
pub fn build_user_summary(
    identity: Option<crate::auth::UserIdentity>,
    quota: Option<crate::quota::cache::QuotaCache>,
) -> AccountUserSummary {
    match identity {
        Some(i) => {
            let tier = quota
                .as_ref()
                .map(|c| match c.response.tier {
                    crate::quota::cache::QuotaTier::Free => "free",
                    crate::quota::cache::QuotaTier::Pro => "pro",
                    crate::quota::cache::QuotaTier::Enterprise => "enterprise",
                })
                .unwrap_or("free")
                .to_string();
            AccountUserSummary {
                signed_in: true,
                login: Some(i.login),
                avatar_url: Some(i.avatar_url),
                tier,
            }
        }
        None => AccountUserSummary {
            signed_in: false,
            login: None,
            avatar_url: None,
            tier: "free".to_string(),
        },
    }
}

/// IPC entry point. Reads the cached `UserIdentity` (non-sensitive) and the
/// quota cache (non-sensitive), assembles the summary, and returns it. Never
/// reads the keychain — the bearer token stays Rust-side, accessed only by
/// the eval-server's platform proxy.
#[tauri::command]
pub fn account_get_user_summary() -> AccountUserSummary {
    let identity = crate::auth::load_identity_cache().ok().flatten();
    let quota = crate::quota::cache::load_quota_cache().ok().flatten();
    build_user_summary(identity, quota)
}

/// Returns the platform origin to use for `/api/v1/account/*` requests.
/// Pure (env-only) so unit tests can verify the override path.
#[tauri::command]
pub fn account_get_platform_url() -> String {
    resolve_platform_url(std::env::var(PLATFORM_URL_ENV).ok().as_deref())
}

/// Resolve the platform URL given an optional override (typically from
/// `std::env::var(PLATFORM_URL_ENV)`). Trims whitespace + trailing
/// slashes so callers always get a canonical form.
pub fn resolve_platform_url(env_override: Option<&str>) -> String {
    match env_override {
        Some(s) => {
            let trimmed = s.trim().trim_end_matches('/');
            if trimmed.is_empty() {
                DEFAULT_PLATFORM_URL.to_string()
            } else {
                trimmed.to_string()
            }
        }
        None => DEFAULT_PLATFORM_URL.to_string(),
    }
}
