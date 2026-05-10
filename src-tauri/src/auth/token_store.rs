// 0831 auth — token_store: keyring-backed token storage + identity cache file.
//
// Two responsibilities:
//   1. Sensitive: GitHub OAuth `access_token` lives in the OS keychain (macOS
//      Keychain / Windows Credential Manager / Linux libsecret) via the
//      `keyring` crate (ADR-0831-01). Service name = SERVICE_NAME, account
//      name = ACCOUNT_NAME. Cross-platform consistency is the whole reason
//      we picked `keyring`.
//   2. Non-sensitive cached snapshot: `UserIdentity` (login + avatar URL +
//      email) is plain JSON at `~/.vskill/cache/identity.json`. This is read
//      on cold start so the UI can render the user chip before the first
//      `/user` round-trip completes — the token still lives in keychain.
//
// Keychain access on macOS is gated by `tauri-build`'s code-signing setup —
// the bundle's entitlements already grant Keychain access via Security.framework
// (linked transitively through `tauri`). No extra entitlement plist needed.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// Service name registered in the OS keychain. Visible to users in macOS
/// Keychain Access.app under this exact label.
pub const SERVICE_NAME: &str = "com.verifiedskill.desktop";

/// Account name slot in the keychain. We only ever store ONE token at a time
/// — sign-out clears it; sign-in overwrites. Adding more accounts later is a
/// matter of extending this constant set.
pub const ACCOUNT_NAME: &str = "github-oauth-token";

/// Errors surfaced by the token store. The keyring crate's error enum is
/// re-mapped into a stringly form so the caller doesn't need a `keyring`
/// dependency just to match on it.
#[derive(Debug)]
pub enum TokenStoreError {
    /// Keyring backend rejected the operation (locked keychain, denied
    /// permission, missing service on Linux, etc.).
    Backend(String),
    /// Filesystem error while reading/writing the identity-cache JSON.
    Cache(String),
}

impl std::fmt::Display for TokenStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TokenStoreError::Backend(msg) => write!(f, "keyring backend error: {msg}"),
            TokenStoreError::Cache(msg) => write!(f, "identity cache error: {msg}"),
        }
    }
}

impl std::error::Error for TokenStoreError {}

/// Wrapper over `keyring::Entry` exposing only the three operations the rest
/// of the codebase needs. Stateless and cheap to construct — there is no
/// keychain handle to keep alive between calls.
pub struct TokenStore;

impl TokenStore {
    /// Construct a new store handle. Reserved for symmetry with future
    /// per-account variants; today it's a no-op marker.
    pub fn new() -> Self {
        Self
    }

    fn entry() -> Result<keyring::Entry, TokenStoreError> {
        keyring::Entry::new(SERVICE_NAME, ACCOUNT_NAME)
            .map_err(|e| TokenStoreError::Backend(e.to_string()))
    }

    /// Persist `token` to the OS keychain, overwriting any existing value
    /// for the same (service, account) slot.
    pub fn save(&self, token: &str) -> Result<(), TokenStoreError> {
        let entry = Self::entry()?;
        entry
            .set_password(token)
            .map_err(|e| TokenStoreError::Backend(e.to_string()))
    }

    /// Read the stored token. Returns `Ok(None)` when no entry exists (clean
    /// signed-out state) — only `Err` for *unexpected* backend failures.
    ///
    /// Currently unused by the IPC layer (the desktop fetches a fresh
    /// identity from /user on demand instead of trusting the cache for
    /// auth). Marked `allow(dead_code)` to keep the public API stable for
    /// the quota-sync agent which will need it later.
    #[allow(dead_code)]
    pub fn load(&self) -> Result<Option<Zeroizing<String>>, TokenStoreError> {
        let entry = Self::entry()?;
        match entry.get_password() {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            // The keyring crate returns NoEntry for both "never set" and
            // "deleted" — both are clean cold-start states from our POV.
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(TokenStoreError::Backend(e.to_string())),
        }
    }

    /// Delete the keychain entry. Idempotent — calling on a missing entry
    /// returns Ok(()). Used by sign-out and by tests for cleanup.
    pub fn clear(&self) -> Result<(), TokenStoreError> {
        let entry = Self::entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(TokenStoreError::Backend(e.to_string())),
        }
    }
}

impl Default for TokenStore {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Identity cache — non-sensitive, plain JSON on disk so the UI can render the
// user chip on cold start before the network /user round-trip.
// ---------------------------------------------------------------------------

/// Snapshot of the signed-in user. Mirrors the fields the UI renders in the
/// top-rail dropdown plus a `cached_at` for staleness display. The shape is
/// frozen at this struct so the IPC layer and the UI agree without needing
/// a typed bridge schema.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserIdentity {
    /// GitHub login (e.g. "octocat"). Required.
    pub login: String,
    /// GitHub avatar URL (typically `https://avatars.githubusercontent.com/u/<id>?v=4`).
    pub avatar_url: String,
    /// User's primary public email if exposed by `/user`. May be null even
    /// for valid users (most modern GitHub accounts hide this).
    #[serde(default)]
    pub email: Option<String>,
    /// ISO-8601 timestamp of when the snapshot was last refreshed. Optional
    /// for forward-compat — older cache files without this field still load.
    #[serde(default)]
    pub cached_at: Option<String>,
}

/// Returns `~/.vskill/cache/identity.json`. Ensures the parent directory
/// exists on first call. Returns `None` if `$HOME` cannot be resolved (rare
/// — only happens on broken Unix environments without a HOME env).
fn identity_cache_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(".vskill").join("cache").join("identity.json"))
}

/// Persist `identity` to the cache file. Best-effort — failure does not
/// surface to the user; we still have the token in keychain and the UI can
/// re-fetch from `/user` on next sign-in. Logs a warning on failure.
pub fn save_identity_cache(identity: &UserIdentity) -> Result<(), TokenStoreError> {
    let path = identity_cache_path().ok_or_else(|| {
        TokenStoreError::Cache("could not resolve $HOME for identity cache".into())
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| TokenStoreError::Cache(format!("mkdir {parent:?}: {e}")))?;
    }
    let json = serde_json::to_string_pretty(identity)
        .map_err(|e| TokenStoreError::Cache(format!("serialize: {e}")))?;
    std::fs::write(&path, json)
        .map_err(|e| TokenStoreError::Cache(format!("write {path:?}: {e}")))
}

/// Read the cached identity snapshot. Returns `Ok(None)` if the file does
/// not exist (clean state). Returns `Err` only for malformed JSON or IO
/// errors that aren't "not found".
pub fn load_identity_cache() -> Result<Option<UserIdentity>, TokenStoreError> {
    let path = match identity_cache_path() {
        Some(p) => p,
        None => return Ok(None),
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let parsed: UserIdentity = serde_json::from_str(&text).map_err(|e| {
                TokenStoreError::Cache(format!("parse identity cache {path:?}: {e}"))
            })?;
            Ok(Some(parsed))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(TokenStoreError::Cache(format!("read {path:?}: {e}"))),
    }
}

/// Remove the cached identity snapshot. Idempotent. Used by sign-out.
pub fn clear_identity_cache() -> Result<(), TokenStoreError> {
    let path = match identity_cache_path() {
        Some(p) => p,
        None => return Ok(()),
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(TokenStoreError::Cache(format!("remove {path:?}: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// macOS round-trip test against the REAL Keychain.
    ///
    /// Gated behind the `VSKILL_TEST_REAL_KEYCHAIN=1` env var because:
    ///   1. CI runners (and `cargo test` in headless test environments) often
    ///      don't have an unlocked login keychain, so save() returns Ok but
    ///      the entry is dropped silently or written to a different keychain
    ///      than the one load() searches.
    ///   2. Running locally this test will trigger a macOS Keychain access
    ///      prompt the first time, which is fine for an interactive run but
    ///      noisy as part of an unattended `cargo test`.
    ///
    /// Run manually with: `VSKILL_TEST_REAL_KEYCHAIN=1 cargo test
    /// token_store_round_trip_real_keychain -- --nocapture`.
    #[test]
    #[cfg(target_os = "macos")]
    fn token_store_round_trip_real_keychain() {
        if std::env::var("VSKILL_TEST_REAL_KEYCHAIN").as_deref() != Ok("1") {
            eprintln!(
                "skipping real-keychain round-trip — set VSKILL_TEST_REAL_KEYCHAIN=1 to enable"
            );
            return;
        }
        let store = TokenStore::new();
        // Ensure the test starts from a known-empty state regardless of any
        // leftover entry from prior runs. `clear` is idempotent.
        store.clear().expect("clear initial state");

        store.save("gho_round_trip_test").expect("save token");
        let loaded = store.load().expect("load token");
        assert_eq!(
            loaded.as_deref().map(|s| s.as_str()),
            Some("gho_round_trip_test")
        );

        store.clear().expect("clear token");
        let after_clear = store.load().expect("load after clear");
        assert!(after_clear.is_none(), "token must be gone after clear");
    }

    #[test]
    fn identity_cache_serializes_and_round_trips() {
        // We don't write to disk here — that would race other tests. Instead
        // exercise the serde codec which is the part the on-disk format
        // depends on.
        let identity = UserIdentity {
            login: "octocat".into(),
            avatar_url: "https://avatars.githubusercontent.com/u/583231?v=4".into(),
            email: Some("octocat@github.com".into()),
            cached_at: Some("2026-05-07T12:00:00Z".into()),
        };
        let json = serde_json::to_string(&identity).expect("serialize");
        let back: UserIdentity = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(identity, back);
    }

    #[test]
    fn identity_cache_accepts_legacy_payload_without_optional_fields() {
        // Older snapshots may not have `email` / `cached_at`. Forward-compat
        // promise: the deserializer fills them with None.
        let legacy = r#"{"login":"x","avatar_url":"https://x"}"#;
        let parsed: UserIdentity =
            serde_json::from_str(legacy).expect("legacy payload must parse");
        assert_eq!(parsed.email, None);
        assert_eq!(parsed.cached_at, None);
    }

    // 0836 US-006 — interop lock with Node side. The canonical service name
    // must remain `com.verifiedskill.desktop`; the Node CLI reads/writes
    // the same slot via `src/lib/keychain.ts`. Renaming either constant
    // without also updating Node + bumping the keychain migration is a P0
    // break — sign-in via desktop wouldn't be visible to the CLI and vice
    // versa.
    #[test]
    fn service_name_is_canonical_for_node_interop() {
        assert_eq!(
            super::SERVICE_NAME,
            "com.verifiedskill.desktop",
            "Renaming the keychain service breaks Node-side interop. If you \
             must rename, also update src/lib/keychain.ts and bump the \
             keychain-migration helper."
        );
        assert_eq!(
            super::ACCOUNT_NAME,
            "github-oauth-token",
            "Renaming the keychain account breaks Node-side interop. If you \
             must rename, also update src/lib/keychain.ts."
        );
    }
}
