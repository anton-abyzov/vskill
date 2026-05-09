// 0834 T-029 — desktop account module.
//
// IPC surface that the Tauri WebView calls so the eval-ui AccountContext
// can build `Authorization: Bearer ${token}` headers when talking to
// verified-skill.com/api/v1/account/*.
//
// Two layers:
//   1. `account_get_token` IPC — returns the keyring-backed OAuth/PAT token
//      currently in `auth::TokenStore`. Returns `None` when signed-out so
//      the UI can fall back to the marketing/login surface.
//   2. `account_get_url` IPC — returns the canonical platform URL the
//      desktop should use. Today it always returns `verified-skill.com`,
//      but the seam exists so the env override (used by AnyModel-style
//      enterprise self-host) can flow through one place rather than being
//      hard-coded inside the React tree.
//
// The `account_get_token` command is the only reason this module exists —
// it doesn't read or write the keyring directly; it just delegates to
// `TokenStore::load()` and stringifies the result. Stateless.

pub mod commands;

#[cfg(test)]
mod tests;
