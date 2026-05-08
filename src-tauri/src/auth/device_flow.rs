// 0831 auth — device_flow: GitHub OAuth Device Authorization Grant client.
//
// Specification reference:
//   https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
//   RFC 8628 — OAuth 2.0 Device Authorization Grant
//
// Two-step flow exposed as a pair of pure-async functions (no embedded loop —
// the caller drives the polling cadence so the UI can show a spinner / let
// the user cancel):
//
//   1. request_device_code(client_id) → DeviceCodeResponse
//      POST https://github.com/login/device/code
//      Body (form-encoded): client_id=<id>&scope=repo,read:user,user:email
//
//   2. poll_device_flow(client_id, device_code) → PollOutcome
//      POST https://github.com/login/oauth/access_token
//      Body (form-encoded):
//        client_id=<id>
//        device_code=<code>
//        grant_type=urn:ietf:params:oauth:grant-type:device_code
//
// The desktop talks DIRECT to github.com (Risk R-6 in plan.md): the platform
// proxy at /api/v1/auth/github/device-flow/* requires `requireUser` (cookie
// auth) which we don't have on first sign-in. Hard-coding the OAuth App's
// PUBLIC `client_id` here is safe per ADR-0831-02.
//
// CLIENT_ID resolution at runtime (in priority order):
//   1. `GITHUB_OAUTH_CLIENT_ID` env var (dev / CI override).
//   2. Compile-time `option_env!("GITHUB_OAUTH_CLIENT_ID")` baked at build.
//   3. `DEFAULT_CLIENT_ID` placeholder constant — this fails closed with
//      `DeviceFlowError::ClientIdMissing` (the IPC layer turns it into a
//      user-readable "OAuth client_id not configured" error per agent spec).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Placeholder client_id. We REFUSE to start a device flow with this value
/// — it's only here so a fresh checkout still compiles. Replace via env var
/// `GITHUB_OAUTH_CLIENT_ID` before shipping.
pub const DEFAULT_CLIENT_ID: &str = "Iv1.placeholder-replace-before-ship";

/// OAuth scopes requested for the desktop OAuth App. `repo` is needed for
/// future private-repo writes (Pro tier); `read:user` for the avatar/login;
/// `user:email` so the platform can match against the existing User table.
const SCOPES: &str = "repo,read:user,user:email";

/// GitHub device-code endpoint URL. Module-level constant so the test suite
/// can swap to a mockito server without changing the production flow path.
const GITHUB_DEVICE_CODE_URL: &str = "https://github.com/login/device/code";

/// GitHub access-token (poll target) URL.
const GITHUB_ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

/// Resolve the client_id to use at runtime. The function is `pub` so the
/// IPC layer can surface a "configuration error" diagnostic before opening a
/// browser to a known-bad value.
pub fn resolve_client_id() -> String {
    if let Ok(env_id) = std::env::var("GITHUB_OAUTH_CLIENT_ID") {
        if !env_id.trim().is_empty() {
            return env_id;
        }
    }
    if let Some(baked) = option_env!("GITHUB_OAUTH_CLIENT_ID") {
        if !baked.trim().is_empty() {
            return baked.to_string();
        }
    }
    DEFAULT_CLIENT_ID.to_string()
}

/// Returns true when the resolved client_id is the placeholder. The IPC
/// layer uses this to refuse to open a browser to a guaranteed-broken flow.
pub fn is_placeholder(client_id: &str) -> bool {
    client_id == DEFAULT_CLIENT_ID
}

/// Initial response from `/login/device/code`. We surface the whole payload
/// to the caller so the UI can:
///   - display `user_code` + a copy button
///   - open `verification_uri` in the browser
///   - schedule polling at `interval` seconds
///   - bail out at `expires_in` seconds
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    /// Long opaque code for the polling endpoint. Treat as sensitive — it
    /// becomes a token if leaked to a third party during the polling window.
    pub device_code: String,
    /// Short user-friendly code (e.g. "WDJB-MJHT") shown in the UI.
    pub user_code: String,
    /// URL to open in a browser. GitHub returns
    /// "https://github.com/login/device".
    pub verification_uri: String,
    /// Polling interval in seconds. We honor this to avoid `slow_down`.
    pub interval: u64,
    /// How long the device_code remains valid, in seconds.
    pub expires_in: u64,
}

/// One iteration of the polling loop. Caller maps these to UI state
/// transitions:
///   - `Pending` → keep spinner, sleep `interval`, re-poll
///   - `SlowDown(new_interval)` → bump `interval` and keep polling
///   - `Granted(token)` → save to keychain, fetch /user, exit loop
///   - `Denied` / `Expired` → user-facing error, end of flow
#[derive(Debug)]
pub enum PollOutcome {
    Pending,
    SlowDown { new_interval: u64 },
    Granted { access_token: Zeroizing<String> },
    Denied,
    Expired,
}

/// Errors that abort the device flow entirely (separate from `Pending` /
/// `Denied` / `Expired` which are normal protocol states).
#[derive(Debug)]
pub enum DeviceFlowError {
    /// `GITHUB_OAUTH_CLIENT_ID` is missing (placeholder still in place).
    /// This is a configuration error — the bundle ships without a client_id
    /// and the build pipeline didn't set it.
    ClientIdMissing,
    /// Network / TLS / DNS failure. Caller maps to "Try again".
    Network(String),
    /// HTTP status outside the protocol's defined success/error envelope.
    Http { status: u16, body: String },
    /// Response JSON didn't match the expected shape.
    Parse(String),
}

impl std::fmt::Display for DeviceFlowError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ClientIdMissing => write!(
                f,
                "OAuth client_id not configured \u{2014} set GITHUB_OAUTH_CLIENT_ID in tauri.conf.json"
            ),
            Self::Network(m) => write!(f, "network: {m}"),
            Self::Http { status, body } => write!(f, "http {status}: {body}"),
            Self::Parse(m) => write!(f, "parse: {m}"),
        }
    }
}

impl std::error::Error for DeviceFlowError {}

/// Build the User-Agent string GitHub recognizes. Constant per build.
fn user_agent() -> String {
    format!("vskill-desktop/{}", env!("CARGO_PKG_VERSION"))
}

/// Step 1 — fetch a device + user code pair from GitHub.
///
/// `client_id_override` is provided for testing (point at a mock server's
/// echo handler). Production callers pass `None` and resolve via
/// `resolve_client_id`.
pub async fn request_device_code(client_id: &str) -> Result<DeviceCodeResponse, DeviceFlowError> {
    request_device_code_at(GITHUB_DEVICE_CODE_URL, client_id).await
}

/// Lower-level: same as `request_device_code` but lets the caller swap the
/// endpoint URL (mockito tests). Production callers should use the public
/// wrapper above.
pub async fn request_device_code_at(
    url: &str,
    client_id: &str,
) -> Result<DeviceCodeResponse, DeviceFlowError> {
    if is_placeholder(client_id) {
        return Err(DeviceFlowError::ClientIdMissing);
    }

    let client = build_client()?;
    let resp = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[("client_id", client_id), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|e| DeviceFlowError::Network(e.to_string()))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(DeviceFlowError::Http {
            status: status.as_u16(),
            body,
        });
    }

    let payload: DeviceCodeResponse = resp
        .json()
        .await
        .map_err(|e| DeviceFlowError::Parse(format!("device code: {e}")))?;
    Ok(payload)
}

/// Step 2 — poll for the access_token. Caller schedules its own sleep
/// between calls so the UI stays responsive (and so cancellation is just
/// "stop calling poll_device_flow").
pub async fn poll_device_flow(
    client_id: &str,
    device_code: &str,
) -> Result<PollOutcome, DeviceFlowError> {
    poll_device_flow_at(GITHUB_ACCESS_TOKEN_URL, client_id, device_code).await
}

/// Lower-level polling helper for tests. Swaps the endpoint URL.
pub async fn poll_device_flow_at(
    url: &str,
    client_id: &str,
    device_code: &str,
) -> Result<PollOutcome, DeviceFlowError> {
    if is_placeholder(client_id) {
        return Err(DeviceFlowError::ClientIdMissing);
    }

    let client = build_client()?;
    let resp = client
        .post(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&[
            ("client_id", client_id),
            ("device_code", device_code),
            (
                "grant_type",
                "urn:ietf:params:oauth:grant-type:device_code",
            ),
        ])
        .send()
        .await
        .map_err(|e| DeviceFlowError::Network(e.to_string()))?;

    let status = resp.status();
    // GitHub returns 200 even for the protocol-level pending/slow_down/
    // expired_token / access_denied responses; the body's `error` field is
    // how we distinguish them. Real HTTP errors (5xx, 4xx other than 200)
    // bubble up as `Http`.
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(DeviceFlowError::Http {
            status: status.as_u16(),
            body,
        });
    }

    let payload: PollResponse = resp
        .json()
        .await
        .map_err(|e| DeviceFlowError::Parse(format!("token poll: {e}")))?;

    classify_poll(payload)
}

/// Raw JSON response from the access_token endpoint. GitHub returns either
/// `{access_token: ...}` (success) or `{error: "...", interval?: N}` (one of
/// authorization_pending / slow_down / expired_token / access_denied).
#[derive(Debug, Deserialize)]
struct PollResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    /// Only present on `slow_down`. We honor it by bumping the caller's
    /// next sleep duration.
    #[serde(default)]
    interval: Option<u64>,
}

fn classify_poll(payload: PollResponse) -> Result<PollOutcome, DeviceFlowError> {
    if let Some(token) = payload.access_token {
        return Ok(PollOutcome::Granted {
            access_token: Zeroizing::new(token),
        });
    }
    match payload.error.as_deref() {
        Some("authorization_pending") => Ok(PollOutcome::Pending),
        Some("slow_down") => Ok(PollOutcome::SlowDown {
            // Per RFC 8628, the server MAY return a new interval; if not,
            // the client should still increase its own by at least 5s. We
            // pick max(returned, 5) when no interval is given.
            new_interval: payload.interval.unwrap_or(5),
        }),
        Some("expired_token") => Ok(PollOutcome::Expired),
        Some("access_denied") | Some("unsupported_grant_type") => Ok(PollOutcome::Denied),
        Some(other) => Err(DeviceFlowError::Parse(format!("unknown error: {other}"))),
        None => Err(DeviceFlowError::Parse(
            "response had neither access_token nor error".into(),
        )),
    }
}

fn build_client() -> Result<reqwest::Client, DeviceFlowError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(user_agent())
        .build()
        .map_err(|e| DeviceFlowError::Network(format!("build client: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_client_id_is_rejected() {
        assert!(is_placeholder(DEFAULT_CLIENT_ID));
        assert!(!is_placeholder("Iv1.real-id-1234"));
    }

    #[test]
    fn classify_poll_pending() {
        let payload = PollResponse {
            access_token: None,
            error: Some("authorization_pending".into()),
            interval: None,
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::Pending => {}
            _ => panic!("expected Pending"),
        }
    }

    #[test]
    fn classify_poll_slow_down_uses_returned_interval() {
        let payload = PollResponse {
            access_token: None,
            error: Some("slow_down".into()),
            interval: Some(11),
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::SlowDown { new_interval } => assert_eq!(new_interval, 11),
            _ => panic!("expected SlowDown"),
        }
    }

    #[test]
    fn classify_poll_slow_down_default_interval_when_missing() {
        let payload = PollResponse {
            access_token: None,
            error: Some("slow_down".into()),
            interval: None,
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::SlowDown { new_interval } => assert_eq!(new_interval, 5),
            _ => panic!("expected SlowDown"),
        }
    }

    #[test]
    fn classify_poll_granted_yields_token() {
        let payload = PollResponse {
            access_token: Some("gho_abc123".into()),
            error: None,
            interval: None,
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::Granted { access_token } => {
                assert_eq!(access_token.as_str(), "gho_abc123");
            }
            _ => panic!("expected Granted"),
        }
    }

    #[test]
    fn classify_poll_denied() {
        let payload = PollResponse {
            access_token: None,
            error: Some("access_denied".into()),
            interval: None,
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::Denied => {}
            _ => panic!("expected Denied"),
        }
    }

    #[test]
    fn classify_poll_expired() {
        let payload = PollResponse {
            access_token: None,
            error: Some("expired_token".into()),
            interval: None,
        };
        match classify_poll(payload).expect("classify") {
            PollOutcome::Expired => {}
            _ => panic!("expected Expired"),
        }
    }

    #[test]
    fn classify_poll_unknown_error_is_parse_error() {
        let payload = PollResponse {
            access_token: None,
            error: Some("some_new_error_2030".into()),
            interval: None,
        };
        match classify_poll(payload) {
            Err(DeviceFlowError::Parse(_)) => {}
            other => panic!("expected Parse error, got {other:?}"),
        }
    }

    #[test]
    fn classify_poll_empty_response_is_parse_error() {
        let payload = PollResponse {
            access_token: None,
            error: None,
            interval: None,
        };
        match classify_poll(payload) {
            Err(DeviceFlowError::Parse(_)) => {}
            other => panic!("expected Parse error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn request_device_code_refuses_placeholder() {
        let result = request_device_code(DEFAULT_CLIENT_ID).await;
        assert!(matches!(result, Err(DeviceFlowError::ClientIdMissing)));
    }

    #[tokio::test]
    async fn poll_refuses_placeholder() {
        let result = poll_device_flow(DEFAULT_CLIENT_ID, "device_code_xyz").await;
        assert!(matches!(result, Err(DeviceFlowError::ClientIdMissing)));
    }

    #[tokio::test]
    async fn request_device_code_against_mock_server_returns_payload() {
        // mockito serves a controlled response so we exercise the JSON
        // decode + endpoint plumbing without going to github.com.
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/login/device/code")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{
                    "device_code": "dc_test_long",
                    "user_code": "WDJB-MJHT",
                    "verification_uri": "https://github.com/login/device",
                    "interval": 5,
                    "expires_in": 900
                }"#,
            )
            .create_async()
            .await;

        let url = format!("{}/login/device/code", server.url());
        let payload = request_device_code_at(&url, "Iv1.test-real-id")
            .await
            .expect("payload");
        assert_eq!(payload.user_code, "WDJB-MJHT");
        assert_eq!(payload.interval, 5);
        assert_eq!(payload.verification_uri, "https://github.com/login/device");
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn poll_against_mock_server_handles_pending_then_granted() {
        let mut server = mockito::Server::new_async().await;
        let pending = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"error":"authorization_pending"}"#)
            .expect(1)
            .create_async()
            .await;

        let url = format!("{}/login/oauth/access_token", server.url());
        let outcome = poll_device_flow_at(&url, "Iv1.test-real-id", "device_code_xyz")
            .await
            .expect("poll");
        match outcome {
            PollOutcome::Pending => {}
            _ => panic!("expected Pending"),
        }
        pending.assert_async().await;

        // Replace mock with a granted response and poll again.
        let granted = server
            .mock("POST", "/login/oauth/access_token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"access_token":"gho_test_123","token_type":"bearer","scope":"repo"}"#)
            .expect(1)
            .create_async()
            .await;

        let outcome = poll_device_flow_at(&url, "Iv1.test-real-id", "device_code_xyz")
            .await
            .expect("poll");
        match outcome {
            PollOutcome::Granted { access_token } => {
                assert_eq!(access_token.as_str(), "gho_test_123");
            }
            _ => panic!("expected Granted"),
        }
        granted.assert_async().await;
    }
}
