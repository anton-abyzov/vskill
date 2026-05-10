// 0836 US-005 — best-effort GitHub OAuth grant revocation on sign-out.
//
// The platform-side endpoint at `https://verified-skill.com/api/v1/auth/github/grant`
// holds the OAuth App `client_secret` (per ADR-0831-02 — desktop binary
// must NOT bake the secret) and proxies to GitHub's
// `DELETE /applications/{client_id}/grant`. Killing the grant invalidates
// every token issued to this user × app pair, including any leaked copies.
//
// Sign-out flow:
//   1. Read keychain token (Zeroizing<String>).
//   2. Spawn task with 5s timeout: DELETE /api/v1/auth/github/grant with Bearer.
//   3. Always clear keychain + identity cache regardless of step 2.
//
// We log INFO on `Revoked` / `AlreadyInvalid` and WARN on `Failed`. The
// `gho_*` token MUST NOT appear in any log line — only the endpoint URL,
// HTTP status, and elapsed time.

use std::time::Duration;

const DEFAULT_PLATFORM_URL: &str = "https://verified-skill.com";
const REVOKE_PATH: &str = "/api/v1/auth/github/grant";
const REVOKE_TIMEOUT: Duration = Duration::from_secs(5);

/// Outcome of a single revocation attempt. The caller maps these to log
/// levels: `Revoked` / `AlreadyInvalid` are INFO, `Failed` is WARN.
#[derive(Debug, PartialEq, Eq)]
pub enum RevocationOutcome {
    /// 200/204 — grant deleted at GitHub.
    Revoked,
    /// 401 — token already invalid (likely user revoked from
    /// github.com/settings/applications, or token expired). Treated as
    /// success per AC-US5-04 — the local state will be cleared regardless.
    AlreadyInvalid,
    /// 5xx, network, timeout, OR 404 (platform endpoint unreachable —
    /// CDN cache miss / pre-deploy build / unrouted hostname). Best-effort
    /// failed. The keychain is still cleared by the caller; this signals
    /// "no server-side action confirmed". 404 is mapped here rather than
    /// `AlreadyInvalid` because in this codebase the platform endpoint
    /// ships with the desktop release — a 404 means deployment lag, not
    /// that the user's grant is actually gone. Collapsing 404 to success
    /// would make a deploy gap silent in field telemetry.
    Failed(String),
}

/// Build the absolute revocation URL from an optional platform-base override.
/// `None` resolves to the production platform.
fn revoke_url(platform_url: Option<&str>) -> String {
    let base = platform_url
        .map(|s| s.trim_end_matches('/'))
        .unwrap_or(DEFAULT_PLATFORM_URL);
    format!("{base}{REVOKE_PATH}")
}

/// Best-effort GitHub OAuth grant revocation.
///
/// Calls `DELETE {platform_url}/api/v1/auth/github/grant` with
/// `Authorization: Bearer <token>` and a 5s hard timeout. The token never
/// appears in logs; on failure we surface only the endpoint, status, and
/// reason.
///
/// The platform endpoint exists at vskill-platform's
/// `src/app/api/v1/auth/github/grant/route.ts` (0836 US-005). If a 404
/// reaches the desktop, that signals deployment lag (CDN cache miss,
/// pre-deploy build, unrouted hostname) rather than a permanent gap.
/// We surface 404 as `Failed("http 404 (endpoint unreachable)")` — the
/// caller proceeds with local cleanup unchanged. We deliberately do NOT
/// collapse 404 to `AlreadyInvalid`: doing so would make a missing-endpoint
/// deployment indistinguishable from a successful revocation in field
/// telemetry. 401 is the only "already invalid" status we trust per AC-US5-04.
pub async fn revoke_grant(
    token: &str,
    platform_url: Option<&str>,
) -> RevocationOutcome {
    let url = revoke_url(platform_url);

    let client = match reqwest::Client::builder()
        .timeout(REVOKE_TIMEOUT)
        .user_agent(concat!("vskill-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => return RevocationOutcome::Failed(format!("client build: {e}")),
    };

    // We pass the token as a Bearer header. The platform proxy reads it,
    // looks up the corresponding client_secret, and calls GitHub. The
    // token NEVER leaves this process unencrypted (HTTPS is enforced by
    // the platform URL scheme).
    let bearer = format!("Bearer {token}");
    let res = client
        .delete(&url)
        .header(reqwest::header::AUTHORIZATION, bearer)
        .send()
        .await;
    // The bearer string is dropped here as soon as `send()` consumes it
    // — we do not retain it beyond the call.

    match res {
        Ok(resp) => {
            let status = resp.status().as_u16();
            match status {
                200 | 204 => RevocationOutcome::Revoked,
                // AC-US5-04: 401 = token already invalid → success.
                401 => RevocationOutcome::AlreadyInvalid,
                // 404 = platform endpoint missing on the target deployment.
                // The endpoint exists in the platform repo (0836 US-005),
                // but a CDN cache miss / pre-deploy build / unrouted
                // hostname can still produce 404. Surface as Failed so
                // field operators can detect deployment lag.
                404 => RevocationOutcome::Failed("http 404 (endpoint unreachable)".into()),
                _ => RevocationOutcome::Failed(format!("http {status}")),
            }
        }
        Err(e) if e.is_timeout() => RevocationOutcome::Failed("timeout".into()),
        Err(e) => RevocationOutcome::Failed(format!("network: {e}")),
    }
}

/// 0836 US-005 — testable sign-out core. Decoupled from Tauri so the
/// call-order contract (revoke BEFORE clear) is enforceable in unit tests
/// without booting the IPC layer. Returns `Ok(())` even if revocation fails;
/// the Err branch only fires when local cleanup itself fails.
///
/// `revoke_fn` lets tests inject a stub. `clear_fn` is the local-state
/// reset (typically `move || (TokenStore::new().clear(), clear_identity_cache())`).
/// `record_call(label)` is the order-tracker — invoked once before revoke
/// and once before clear so tests can assert sequence.
pub async fn perform_sign_out<RFut, CFn>(
    token: Option<&str>,
    revoke_fn: impl FnOnce(String) -> RFut,
    clear_fn: CFn,
    mut record_call: impl FnMut(&str),
) -> Result<RevocationOutcome, String>
where
    RFut: std::future::Future<Output = RevocationOutcome>,
    CFn: FnOnce() -> Result<(), String>,
{
    // STEP 1: revoke (if a token exists) — runs BEFORE clear.
    record_call("revoke");
    let outcome = match token {
        Some(t) => revoke_fn(t.to_string()).await,
        None => RevocationOutcome::AlreadyInvalid,
    };

    // STEP 2: ALWAYS clear local state, regardless of step 1.
    record_call("clear");
    clear_fn()?;

    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mockito serves a controllable HTTP endpoint at a non-prod URL so we
    // can exercise the revocation logic without going to verified-skill.com.

    #[tokio::test]
    async fn ok_status_returns_revoked() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true,"revoked":true}"#)
            .create_async()
            .await;

        let outcome =
            revoke_grant("gho_test_token_value", Some(&server.url())).await;
        assert_eq!(outcome, RevocationOutcome::Revoked);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn no_content_status_returns_revoked() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .with_status(204)
            .create_async()
            .await;

        let outcome = revoke_grant("gho_test", Some(&server.url())).await;
        assert_eq!(outcome, RevocationOutcome::Revoked);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn unauthorized_status_returns_already_invalid() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .with_status(401)
            .with_body(r#"{"error":"token_invalid"}"#)
            .create_async()
            .await;

        let outcome = revoke_grant("gho_expired", Some(&server.url())).await;
        assert_eq!(outcome, RevocationOutcome::AlreadyInvalid);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn not_found_status_returns_failed_not_deployed() {
        // 404 = platform endpoint unreachable (CDN cache miss /
        // pre-deploy build / unrouted hostname). The endpoint ships with
        // the desktop release; a 404 here means deployment lag, not a
        // permanent gap. We surface this as Failed (not AlreadyInvalid)
        // so field operators can detect lag rather than seeing a
        // misleading success log.
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .with_status(404)
            .create_async()
            .await;

        let outcome = revoke_grant("gho_test", Some(&server.url())).await;
        match outcome {
            RevocationOutcome::Failed(msg) => {
                assert!(
                    msg.contains("404"),
                    "expected 404 in failure msg, got: {msg}"
                );
                assert!(
                    msg.contains("unreachable"),
                    "expected 'unreachable' hint, got: {msg}"
                );
            }
            other => panic!("expected Failed, got {other:?}"),
        }
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn server_error_returns_failed_with_status() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .with_status(503)
            .with_body("upstream unavailable")
            .create_async()
            .await;

        let outcome = revoke_grant("gho_test", Some(&server.url())).await;
        match outcome {
            RevocationOutcome::Failed(m) => assert!(m.contains("503"), "msg: {m}"),
            other => panic!("expected Failed, got {other:?}"),
        }
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn sends_bearer_authorization_header() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("DELETE", "/api/v1/auth/github/grant")
            .match_header("authorization", "Bearer gho_match_me")
            .with_status(200)
            .create_async()
            .await;

        let outcome = revoke_grant("gho_match_me", Some(&server.url())).await;
        assert_eq!(outcome, RevocationOutcome::Revoked);
        mock.assert_async().await;
    }

    #[test]
    fn revoke_url_uses_default_when_none() {
        assert_eq!(
            revoke_url(None),
            "https://verified-skill.com/api/v1/auth/github/grant",
        );
    }

    #[test]
    fn revoke_url_strips_trailing_slash_from_override() {
        assert_eq!(
            revoke_url(Some("https://verified-skill.dev/")),
            "https://verified-skill.dev/api/v1/auth/github/grant",
        );
    }

    // -------------------------------------------------------------------------
    // 0836 US-005 — perform_sign_out call-order contract (AC-US5-05).
    //
    // Revocation MUST run BEFORE the local-state clear, regardless of the
    // revocation outcome. The test injects a sequence recorder that captures
    // the order of "revoke" and "clear" calls and asserts the contract.
    // -------------------------------------------------------------------------

    #[tokio::test]
    async fn sign_out_calls_revoke_before_clear_on_success() {
        let order: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
            std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

        let order_outer = order.clone();
        let order_for_revoke = order.clone();
        let order_for_clear = order.clone();
        let result = perform_sign_out(
            Some("gho_test_value"),
            move |_token| {
                let order = order_for_revoke.clone();
                async move {
                    order.lock().unwrap().push("revoke_fn".into());
                    RevocationOutcome::Revoked
                }
            },
            move || {
                order_for_clear.lock().unwrap().push("clear_fn".into());
                Ok(())
            },
            move |label| {
                order_outer.lock().unwrap().push(label.to_string());
            },
        )
        .await;

        assert_eq!(result.unwrap(), RevocationOutcome::Revoked);
        let seq = order.lock().unwrap().clone();
        // Order: record("revoke") -> revoke_fn ran -> record("clear") -> clear_fn ran.
        let revoke_idx = seq.iter().position(|x| x == "revoke_fn").unwrap();
        let clear_idx = seq.iter().position(|x| x == "clear_fn").unwrap();
        assert!(
            revoke_idx < clear_idx,
            "revoke_fn must run BEFORE clear_fn: seq={seq:?}",
        );
    }

    #[tokio::test]
    async fn sign_out_clears_even_when_revoke_fails() {
        // The keychain MUST always be cleared, otherwise a user on a flight
        // who hits Sign Out has their token sitting in the keyring until
        // the next launch.
        let cleared = std::sync::Arc::new(std::sync::Mutex::new(false));
        let cleared_for_clear = cleared.clone();
        let result = perform_sign_out(
            Some("gho_will_fail"),
            |_| async { RevocationOutcome::Failed("network: timeout".into()) },
            move || {
                *cleared_for_clear.lock().unwrap() = true;
                Ok(())
            },
            |_| {},
        )
        .await;

        // perform_sign_out returns Ok with the failed outcome — the caller
        // logs WARN but the user-facing sign-out still succeeds.
        assert!(matches!(result, Ok(RevocationOutcome::Failed(_))));
        assert!(*cleared.lock().unwrap(), "clear must run despite revoke failure");
    }

    #[tokio::test]
    async fn sign_out_skips_revoke_when_no_token() {
        // Already-signed-out state — clear runs but revoke is bypassed.
        // We assert this by tracking whether revoke_fn was invoked.
        let revoke_called = std::sync::Arc::new(std::sync::Mutex::new(false));
        let revoke_for_call = revoke_called.clone();
        let cleared = std::sync::Arc::new(std::sync::Mutex::new(false));
        let cleared_for_clear = cleared.clone();
        let result = perform_sign_out(
            None, // <- no token
            move |_| {
                let revoke_called = revoke_for_call.clone();
                async move {
                    *revoke_called.lock().unwrap() = true;
                    RevocationOutcome::Revoked
                }
            },
            move || {
                *cleared_for_clear.lock().unwrap() = true;
                Ok(())
            },
            |_| {},
        )
        .await;

        assert_eq!(result.unwrap(), RevocationOutcome::AlreadyInvalid);
        assert!(!*revoke_called.lock().unwrap(), "revoke_fn must NOT run with no token");
        assert!(*cleared.lock().unwrap(), "clear must always run");
    }

    #[tokio::test]
    async fn sign_out_returns_err_when_clear_fails() {
        let result = perform_sign_out(
            Some("gho_fine"),
            |_| async { RevocationOutcome::Revoked },
            || Err("clear keychain: backend locked".into()),
            |_| {},
        )
        .await;
        assert!(matches!(result, Err(msg) if msg.contains("backend locked")));
    }
}
