// Preferences window + settings module skeleton.
//
// Phase 1 (cargo-deps + IPC contract) shipped only this module declaration so
// downstream agents could `mod preferences;` from `lib.rs` and add submodules:
//
//   - settings-persistence-agent owns `settings.rs` (atomic writes, debouncer).
//   - preferences-window-agent owns `window.rs` (open/focus WebviewWindow).
//   - tab agents own `general.rs`, `updates.rs`, `privacy.rs`, `advanced.rs`.
//
// Phase 3 (this commit) lands `window.rs` — the lazy-create / focus-existing
// shell for the Preferences `WebviewWindow`. See ADR 0830-01 for the
// separate-window-vs-modal rationale.
pub mod window;

// Phase 2 (this commit) lands `settings.rs` — atomic writes, 250ms debouncer,
// 0600 perms on Unix, schema-v1 with discard-on-version-mismatch recovery.
// See ADR 0830-02 for the hand-rolled-vs-tauri-plugin-store rationale.
pub mod settings;

// Phase 5 (this commit) lands `updater.rs` — wraps tauri-plugin-updater@2.10.1
// behind the US-003 / US-007 / US-009 state machine, honours
// `updates.skippedVersion`, persists `updates.lastCheckedAt`, and emits the
// `updater://*` event channels the UI subscribes to.
pub mod updater;

#[allow(unused_imports)]
pub use settings::{Settings, SettingsStore};
#[allow(unused_imports)]
pub use updater::{UpdateState, UpdaterState};
