// 0836 US-004 — build-time assertion against the placeholder OAuth client_id.
//
// v1.0.17 shipped with `Iv1.placeholder-replace-before-ship` baked into the
// signed binary because the build pipeline forgot to set
// `GITHUB_OAUTH_CLIENT_ID`. The runtime guard inside `device_flow.rs` caught
// the symptom at the user (a "Configuration error" toast on first sign-in)
// but the binary itself was already in users' hands. This script is the
// build-pipeline-side gate.
//
// Implementation notes (per ADR-0836-04):
//   - Use `PROFILE` env (set by cargo for build scripts) to detect the
//     target profile. `cfg!(debug_assertions)` here would reflect HOW the
//     build script itself was compiled, NOT the target profile — wrong.
//   - `panic!` is the right shape for a build-script failure: cargo
//     surfaces it as "build failed: …" with the full message visible.
//   - Local `cargo build` (debug) is intentionally unaffected so day-to-day
//     iteration on UI / sidecar / non-auth features doesn't require an
//     OAuth App for every contributor. The runtime guard catches usage.
//   - `rerun-if-env-changed` ensures cargo invalidates the cached build
//     when CI rotates the secret.
//
// CI defense-in-depth: `.github/workflows/desktop-release.yml` runs
// `strings <bundle> | grep -q 'Iv1.placeholder-replace-before-ship'` after
// signing+notarization so a hand-rolled binary can't sneak the placeholder
// past this gate.

const PLACEHOLDER_CLIENT_ID: &str = "Iv1.placeholder-replace-before-ship";

fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_OAUTH_CLIENT_ID");

    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "release" {
        let client_id = std::env::var("GITHUB_OAUTH_CLIENT_ID").unwrap_or_default();
        if client_id.is_empty() || client_id == PLACEHOLDER_CLIENT_ID {
            panic!(
                "GITHUB_OAUTH_CLIENT_ID is unset or equals the placeholder \
                 ({PLACEHOLDER_CLIENT_ID}); release builds REQUIRE a real \
                 OAuth App client_id. Set it in CI secrets / shell env \
                 before `cargo build --release`. See \
                 src-tauri/README.md and \
                 .specweave/docs/internal/specs/oauth-client-id-rotation.md."
            );
        }
    }

    tauri_build::build()
}
