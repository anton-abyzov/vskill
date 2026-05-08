// 0831 auth — github_client: minimal HTTP layer for GitHub user-data lookups.
//
// Scope of THIS file (T-008 in the agent's task slice — slim version covering
// only what device-flow + UserDropdown need):
//   - fetch_user(token)  : GET https://api.github.com/user → UserIdentity
//
// Out-of-scope (deferred to the auth-broader T-008 task on the closer plan):
//   - get_repo(owner, repo, token)   : repo visibility check (US-004)
//   - revoke_token(token, app_creds) : DELETE /applications/{id}/token (US-002)
//
// The desktop-folder-agent / future agent owns those follow-ups; we ship the
// minimum here so device_flow.rs can finalize sign-in by stamping a fresh
// `UserIdentity` into the cache.

use std::time::Duration;

use serde::Deserialize;
use zeroize::Zeroizing;

use super::token_store::UserIdentity;

/// User-Agent header required by the GitHub API. They reject requests with
/// no UA, and they de-prioritize generic ones in their abuse heuristics.
const USER_AGENT: &str = concat!("vskill-desktop/", env!("CARGO_PKG_VERSION"));

/// GitHub `/user` response shape (only the fields we surface to the UI).
/// Extra fields are ignored by serde — adding columns later is non-breaking.
#[derive(Debug, Clone, Deserialize)]
struct GithubUser {
    login: String,
    avatar_url: String,
    #[serde(default)]
    email: Option<String>,
}

/// Errors surfaced to callers. Mapped to plain strings at the IPC boundary.
#[derive(Debug)]
pub enum GithubClientError {
    /// Network-level failure: DNS, TLS, connection reset, timeout.
    Network(String),
    /// HTTP 401 — token is bad. Caller should treat as "signed out".
    Unauthorized,
    /// HTTP 4xx (other) or 5xx with body for diagnostics.
    Http { status: u16, body: String },
    /// Response parsed shape mismatch (unexpected JSON).
    Parse(String),
}

impl std::fmt::Display for GithubClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(m) => write!(f, "network: {m}"),
            Self::Unauthorized => write!(f, "unauthorized (401)"),
            Self::Http { status, body } => write!(f, "http {status}: {body}"),
            Self::Parse(m) => write!(f, "parse: {m}"),
        }
    }
}

impl std::error::Error for GithubClientError {}

/// Re-export so callers don't have to import a second module just for the
/// snapshot type. (Actual definition is in `token_store` — same struct shape
/// is used both in-memory and on-disk.)
#[allow(unused_imports)]
pub use super::token_store::UserIdentity as ReExportedUserIdentity;

/// Fetch the signed-in user from GitHub. The token is wrapped in `Zeroizing`
/// at the caller side; we accept a `&str` here so reqwest can borrow without
/// moving ownership — the caller drops the buffer after this returns.
pub async fn fetch_user(token: &str) -> Result<UserIdentity, GithubClientError> {
    // 10s hard cap on the whole request including TLS handshake. Anything
    // longer means the network is too sick to drive a sign-in flow; the UI
    // surfaces a "Try again" button per AC-US1-06.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| GithubClientError::Network(format!("build client: {e}")))?;

    // Hold the bearer header value in a Zeroizing wrapper so the raw token
    // text is wiped from memory when this function returns (Risk R-1).
    let bearer: Zeroizing<String> = Zeroizing::new(format!("Bearer {token}"));

    let resp = client
        .get("https://api.github.com/user")
        .header(reqwest::header::AUTHORIZATION, bearer.as_str())
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| GithubClientError::Network(format!("send: {e}")))?;

    let status = resp.status();
    if status.as_u16() == 401 {
        return Err(GithubClientError::Unauthorized);
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(GithubClientError::Http {
            status: status.as_u16(),
            body,
        });
    }

    let user: GithubUser = resp
        .json()
        .await
        .map_err(|e| GithubClientError::Parse(format!("decode /user: {e}")))?;

    Ok(UserIdentity {
        login: user.login,
        avatar_url: user.avatar_url,
        email: user.email,
        cached_at: Some(now_iso8601()),
    })
}

/// Format `SystemTime::now()` as ISO-8601 in UTC. Avoids pulling in `chrono`
/// as a dependency for a single timestamp string — the caller treats this as
/// an opaque label, not a parseable timestamp.
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // RFC 3339 / ISO 8601 minimal: YYYY-MM-DDTHH:MM:SSZ derived from epoch.
    // For UI display only — a full chrono dependency is overkill.
    format_epoch_seconds_utc(secs)
}

fn format_epoch_seconds_utc(secs: u64) -> String {
    // Days from 1970-01-01.
    let days = secs / 86_400;
    let secs_of_day = secs % 86_400;
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;
    let (year, month, day) = days_to_ymd(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Convert "days since 1970-01-01" to (year, month, day). Hand-rolled to
/// avoid dragging chrono in. Adapted from civil_from_days in Hinnant's
/// date library — public-domain reference algorithm.
fn days_to_ymd(z: i64) -> (i32, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_zero_renders_as_unix_birthday() {
        // 0 seconds since epoch is 1970-01-01T00:00:00Z. If this ever flips,
        // the date math is wrong and every cached_at timestamp becomes a lie.
        assert_eq!(format_epoch_seconds_utc(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn known_epoch_2026_05_07_renders_correctly() {
        // 2026-05-07T12:00:00Z = 1778155200 seconds since epoch.
        // Verifies the ymd math holds for the current calendar moment so we
        // don't ship a clock that's silently wrong by a day.
        assert_eq!(
            format_epoch_seconds_utc(1_778_155_200),
            "2026-05-07T12:00:00Z"
        );
    }
}
