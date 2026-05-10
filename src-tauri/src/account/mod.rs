// 0834 T-029 / 0836 US-003 — desktop account module.
//
// 0836 US-003: the previous `account_get_token` IPC (which returned the
// raw `gho_*` token to the WebView) is REMOVED. WebView XSS or compromised
// npm deps can no longer exfiltrate the bearer through this module. The
// replacement `account_get_user_summary` returns only display fields
// (login / avatar URL / tier / signedIn). All authenticated HTTP now flows
// through the eval-server's platform-proxy, which injects the bearer
// Rust-side from the keychain.
//
// IPC surface:
//   - `account_get_user_summary` → AccountUserSummary {
//        signedIn, login, avatarUrl, tier
//     } reads identity + quota cache; never the keychain.
//   - `account_get_platform_url` → canonical platform URL (env override
//     supported via VSKILL_PLATFORM_URL).

pub mod commands;

#[cfg(test)]
mod tests;
