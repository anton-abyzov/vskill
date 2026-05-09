// 0834 T-029 — Tauri IPC commands for the /account WebView.
//
// `account_get_token` reads the OAuth/PAT token from the keyring and
// returns it to the WebView so AccountContext.getAuthHeader can produce
// `Authorization: Bearer …`. Returns `None` when no token is stored
// (clean signed-out state); only returns `Err(...)` for genuinely
// unexpected backend failures (locked keychain, denied permission, etc.).
//
// `account_get_platform_url` returns the canonical platform origin. The
// constant lives here rather than in the WebView so power users can
// override via env without touching JS bundles.

use crate::auth::TokenStore;

/// Default platform origin. Env override:
///   VSKILL_PLATFORM_URL=https://verified-skill.dev npm run desktop:dev
const DEFAULT_PLATFORM_URL: &str = "https://verified-skill.com";
const PLATFORM_URL_ENV: &str = "VSKILL_PLATFORM_URL";

/// Read the keyring-backed token. Returns:
///   - `Ok(Some(token))` when a token is stored
///   - `Ok(None)` when the user is signed out
///   - `Err(message)` only on unexpected backend failures
#[tauri::command]
pub fn account_get_token() -> Result<Option<String>, String> {
    read_token_from_store(&TokenStore::new())
}

/// Inner — TokenStore-agnostic so tests can pass a stub. The store
/// trait isn't exported because we only need this one function and
/// over-engineering a trait for one call would obscure intent.
pub fn read_token_from_store(store: &TokenStore) -> Result<Option<String>, String> {
    match store.load() {
        Ok(Some(token)) => {
            // `Zeroizing<String>` derefs to `&str` — clone into a plain
            // String so the value can cross the IPC boundary. The plain
            // String is non-zeroized, but Tauri's serde layer makes that
            // unavoidable; the keyring copy stays the canonical source.
            Ok(Some((*token).clone()))
        }
        Ok(None) => Ok(None),
        Err(e) => Err(format!("keyring read failed: {e}")),
    }
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
