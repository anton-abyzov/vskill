// 0831 auth — GitHub OAuth device-flow + secure token storage.
//
// Module layout (per plan.md §3, this increment owns the desktop-side auth):
//   - token_store    : keyring-backed at-rest token storage (ADR-0831-01)
//   - device_flow    : RFC 8628 client; talks DIRECT to github.com (Risk R-6)
//   - github_client  : thin HTTP layer for /user (and future /repos, /revoke)
//
// Threat model (Risk R-1): tokens are in the OS keychain at rest, loaded into
// memory only on demand, wrapped in `Zeroizing<String>` so the buffer is wiped
// on drop. A local-machine attacker with ptrace can still snapshot live memory
// — that's accepted; OS-level protection (FileVault, etc.) is the right fence.
//
// Client-secret policy (ADR-0831-02): the desktop holds the OAuth App's
// PUBLIC `client_id` only. Device-flow is a public-client grant — there is no
// secret to bake, no secret to leak. If `client_id` is unset at runtime, the
// auth surface fails closed with a configuration error (see device_flow.rs).

pub mod device_flow;
pub mod github_client;
pub mod token_store;

// Re-exports keep `commands.rs` import paths short.
// Re-exports include some types (DeviceCodeResponse, DeviceFlowError,
// DEFAULT_CLIENT_ID) that are part of the module's public Rust API surface
// for downstream agents (quota, repo-detect) but not consumed by the IPC
// layer in this PR. `allow(unused_imports)` keeps the surface intentional
// without spamming warnings.
#[allow(unused_imports)]
pub use device_flow::{
    is_placeholder as is_placeholder_id, poll_device_flow, request_device_code, resolve_client_id,
    DeviceCodeResponse, DeviceFlowError, PollOutcome, DEFAULT_CLIENT_ID,
};
pub use github_client::fetch_user;
pub use token_store::{
    clear_identity_cache, load_identity_cache, save_identity_cache, TokenStore, UserIdentity,
};

#[cfg(test)]
mod tests {
    // Smoke test that the module re-exports compile. The richer test suites
    // live in each submodule.
    use super::*;

    #[test]
    fn reexports_resolve() {
        // Touch each re-exported name so a future rename in a submodule
        // breaks the build here instead of silently in the IPC layer.
        let _: &str = DEFAULT_CLIENT_ID;
        let _ = TokenStore::new();
        // UserIdentity is `Clone + Debug` — instantiating it here proves the
        // re-export path remains valid.
        let _ = UserIdentity {
            login: String::new(),
            avatar_url: String::new(),
            email: None,
            cached_at: None,
        };
    }
}
