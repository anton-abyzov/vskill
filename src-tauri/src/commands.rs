// Tauri commands invokable from the studio frontend (or internal callers).
// Phase-1 surface: get_server_port, restart_server, open_logs_folder, quit.
// 0830 Phase 1 surface: settings + updater + autostart + preferences-window
// stubs (placeholder errors until downstream agents implement).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::preferences::settings::settings_path;
use crate::preferences::SettingsStore;
use crate::sidecar::{self, SharedSidecar};

// ---------------------------------------------------------------------------
// 0830 IPC contract types — shared between Rust and the eval-ui webviews via
// serde. Schema is frozen at this stage so downstream agents (settings,
// preferences-window, tabs) and UI agents code against a stable shape.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppMetadata {
    pub version: String,
    pub build: String,
    pub commit: String,
}

#[tauri::command]
pub fn get_server_port(state: State<'_, SharedSidecar>) -> Option<u16> {
    sidecar::snapshot(state.inner()).port
}

#[tauri::command]
pub async fn restart_server(app: AppHandle) -> Result<u16, String> {
    let state: State<'_, SharedSidecar> = app.state();
    sidecar::reset_strikes(state.inner());
    let shared = state.inner().clone();
    sidecar::graceful_shutdown(shared.clone()).await;
    let port = sidecar::spawn_sidecar(&app, shared).await?;
    sidecar::load_studio_url(&app, port)?;
    Ok(port)
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    open_logs_folder_inner(&app);
    Ok(())
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

pub fn restart_server_inner(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = restart_server(app.clone()).await {
            log::error!("manual restart failed: {e}");
            let _ = app.emit("server-crashed", e);
        }
    });
}

pub fn open_logs_folder_inner(app: &AppHandle) {
    let path = log_dir();
    if let Err(e) = std::fs::create_dir_all(&path) {
        log::warn!("could not create log dir {:?}: {e}", path);
    }
    let path_str = path.to_string_lossy().to_string();
    #[allow(deprecated)]
    if let Err(e) = app.shell().open(&path_str, None) {
        log::error!("failed to open log dir {:?}: {e}", path);
    }
}

pub fn log_dir() -> PathBuf {
    if cfg!(target_os = "macos") {
        if let Some(home) = dirs_home() {
            return home.join("Library").join("Logs").join("vSkill");
        }
    } else if cfg!(target_os = "windows") {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            return PathBuf::from(local).join("vSkill").join("Logs");
        }
    }
    std::env::temp_dir().join("vskill-logs")
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

// ---------------------------------------------------------------------------
// 0830 Phase 1 stubs — return placeholder errors. Real implementations land
// in subsequent phases:
//   - settings-persistence-agent fills get_settings/set_setting/reset_settings
//   - preferences-window-agent fills open_preferences
//   - updates tab agent fills check_for_updates / download_and_install_update
//     / cancel_update via crate::preferences::updates
//   - general tab agent fills set_autostart via tauri-plugin-autostart
//   - get_app_metadata reads from tauri::app::package_info() — stubbed for now
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_settings(
    store: State<'_, SettingsStore>,
) -> Result<serde_json::Value, String> {
    let snapshot = store.get().await;
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_setting(
    store: State<'_, SettingsStore>,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    store.set_key(&key, value).await
}

#[tauri::command]
pub async fn reset_settings(store: State<'_, SettingsStore>) -> Result<(), String> {
    store.reset().await
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateInfo, String> {
    crate::preferences::updater::check_for_updates(app).await
}

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    crate::preferences::updater::download_and_install_update(app).await
}

#[tauri::command]
pub fn cancel_update(app: AppHandle) -> Result<(), String> {
    crate::preferences::updater::cancel_update(app)
}

#[tauri::command]
pub async fn open_preferences(app: AppHandle, tab: Option<String>) -> Result<(), String> {
    crate::preferences::window::open_preferences(&app, tab.as_deref())
}

#[tauri::command]
pub fn get_app_metadata() -> AppMetadata {
    AppMetadata {
        version: env!("CARGO_PKG_VERSION").to_string(),
        build: String::new(),
        commit: String::new(),
    }
}

#[tauri::command]
pub async fn set_autostart(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    // AC-US2-04: persist preference BEFORE flipping the OS-level autolaunch.
    // If the OS toggle fails (MDM, sandbox, etc.) we restore the prior value.
    let previous = store.get().await.general.launch_at_login;
    if let Err(e) = store
        .set_key("general.launchAtLogin", serde_json::json!(enabled))
        .await
    {
        log::warn!("set_autostart: could not persist launchAtLogin={enabled}: {e}");
        return Err(e);
    }

    let manager = app.autolaunch();
    let toggle_result = if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    };

    if let Err(e) = toggle_result {
        // OS toggle failed — best-effort restore of the persisted value so the
        // settings file matches reality. If restore also fails, log loudly but
        // surface the original error to the caller (it's the actionable one).
        log::warn!("set_autostart: OS toggle failed ({e}); restoring launchAtLogin={previous}");
        if let Err(restore_err) = store
            .set_key("general.launchAtLogin", serde_json::json!(previous))
            .await
        {
            log::error!(
                "set_autostart: could not restore launchAtLogin={previous} after OS failure: {restore_err}"
            );
        }
        return Err(e);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Bridge-completion handlers (post-v1.0.12 IPC alignment).
//
// The frontend `useDesktopBridge` ships call sites for these three commands
// (`pick_default_project_folder`, `reveal_settings_file`, `copy_settings_path`)
// but v1.0.12 only registered the settings/updater/autostart surface, so each
// click rejected with "Command not found". `copy_settings_path` is now handled
// by the web Clipboard API in the bridge, leaving these two genuine UI
// features that need Rust:
//   - folder picker uses tauri-plugin-dialog (already registered + capability)
//   - reveal-in-Finder uses tauri-plugin-shell::open (already permissioned)
// ---------------------------------------------------------------------------

/// Result shape returned by `pick_default_project_folder` since 0831.
///
/// The legacy command returned just `Option<String>` (the picked path).
/// 0831 extends it to attach a `FolderClassification` so the UI can fire
/// the home-directory warning modal (US-003 AC-US3-01..04, AC-US3-06)
/// without making a second IPC round-trip. `None` is still returned when
/// the user dismisses the dialog.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PickedFolder {
    /// Absolute path the user selected, lossy-utf8 encoded.
    pub path: String,
    /// Classification per ADR-0831-03's ordered ruleset. UI checks
    /// `kind === "home_root"` or `kind === "personal_scope"` to decide
    /// whether to show the FolderPickerWarning modal.
    pub classification: crate::folders::FolderClassification,
}

#[tauri::command]
pub async fn pick_default_project_folder(app: AppHandle) -> Result<Option<PickedFolder>, String> {
    use tauri_plugin_dialog::DialogExt;

    // tauri-plugin-dialog v2's pick_folder is callback-style; bridge to a
    // oneshot so the Tauri command can return the chosen path (or None on
    // cancel) as a normal awaited Result.
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    app.dialog().file().pick_folder(move |folder| {
        // FilePath -> String. None when the user dismissed the picker.
        let path = folder.and_then(|f| f.into_path().ok())
            .map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path);
    });
    let chosen = rx
        .await
        .map_err(|e| format!("folder picker channel closed: {e}"))?;

    // 0831: classify the chosen path before returning so the UI can fire
    // the warning modal in one round-trip. Cancelled picks short-circuit
    // to None — no need to classify.
    let Some(path) = chosen else {
        return Ok(None);
    };
    let probe = crate::folders::RealFsProbe;
    let classification = crate::folders::classify(std::path::Path::new(&path), &probe);
    Ok(Some(PickedFolder {
        path,
        classification,
    }))
}

#[tauri::command]
pub fn reveal_settings_file(app: AppHandle) -> Result<(), String> {
    let path = settings_path();
    // If the file hasn't been created yet (no setting saved since install),
    // open the parent directory instead so the user still gets a useful
    // Finder window. shell::open accepts directory paths on all platforms.
    let target = if path.exists() {
        path.clone()
    } else {
        path.parent().map(PathBuf::from).unwrap_or_else(|| path.clone())
    };
    let target_str = target.to_string_lossy().to_string();
    #[allow(deprecated)]
    app.shell()
        .open(&target_str, None)
        .map_err(|e| format!("could not reveal {target_str}: {e}"))
}

// ---------------------------------------------------------------------------
// 0832: lifecycle modal IPC surface.
// ---------------------------------------------------------------------------

/// Returns the cached ProcessRecord that triggered the lifecycle modal, or
/// null if none is set. The React layer calls this on mount instead of
/// relying on the lifecycle://detected event (avoids a render-time race).
#[tauri::command]
pub fn get_detected_instance() -> Option<crate::process_discovery::ProcessRecord> {
    crate::lifecycle_modal::current_detected()
}

/// US-002 "Use that instance" — main window navigates to the external
/// studio port and the next sidecar spawn is suppressed via the
/// `skip_spawn_to_port` state flag. Modal is closed.
///
/// 0832 F-010: state mutation is atomic — if `load_studio_url` fails (e.g.,
/// main window vanished), the skip flag and port are rolled back so the next
/// boot can recover normally instead of silently early-returning on a dead port.
#[tauri::command]
pub async fn lifecycle_use_existing(
    app: AppHandle,
    state: tauri::State<'_, SharedSidecar>,
    port: u16,
) -> Result<(), String> {
    let prior = {
        let mut s = state.inner().lock().unwrap();
        let prior_skip = s.skip_spawn_to_port;
        let prior_port = s.port;
        s.skip_spawn_to_port = Some(port);
        s.port = Some(port);
        (prior_skip, prior_port)
    };
    if let Err(e) = sidecar::load_studio_url(&app, port) {
        // Roll back both fields so the user isn't trapped in a half-mutated state.
        let mut s = state.inner().lock().unwrap();
        s.skip_spawn_to_port = prior.0;
        s.port = prior.1;
        return Err(e);
    }
    crate::lifecycle_modal::close(&app);
    Ok(())
}

/// US-002 "Stop it and use desktop app" — SIGTERM the external PID, wait
/// up to 3s, escalate to SIGKILL if needed, then re-trigger normal sidecar
/// boot via restart_server.
///
/// 0832 F-005: defense-in-depth — the pid is validated against the discovered
/// ProcessRecord set before we kill anything. A compromised renderer can't
/// pass an arbitrary user-owned pid through this surface.
#[tauri::command]
pub async fn lifecycle_stop_existing(app: AppHandle, pid: u32) -> Result<(), String> {
    if !pid_is_known_studio_instance(pid).await {
        log::warn!("lifecycle_stop_existing: refused unknown pid {pid}");
        return Err(format!("pid {pid} is not a known studio instance"));
    }
    kill_external_pid(pid).await;
    crate::lifecycle_modal::close(&app);
    // Drive a normal boot. restart_server() does graceful_shutdown of any
    // current child + spawn_sidecar + load_studio_url. The skip flag is NOT
    // set here, so the scanner runs again — which is the right behavior, since
    // the user just confirmed they want this app's sidecar.
    let state: tauri::State<'_, SharedSidecar> = app.state();
    sidecar::reset_strikes(state.inner());
    let shared = state.inner().clone();
    sidecar::graceful_shutdown(shared.clone()).await;
    let port = sidecar::spawn_sidecar(&app, shared).await?;
    sidecar::load_studio_url(&app, port)?;
    Ok(())
}

/// US-002 "Run alongside" — close the modal, let normal boot proceed alongside
/// the existing external instance.
///
/// 0832 F-002 fix: the previous implementation re-entered `spawn_sidecar`,
/// which re-ran the scanner and re-opened the modal because the external
/// instance was still running. We now set a one-shot `bypass_scan_once` flag
/// on `SharedSidecar` so the gate skips the scan exactly once for this call.
#[tauri::command]
pub async fn lifecycle_run_alongside(app: AppHandle) -> Result<(), String> {
    crate::lifecycle_modal::close(&app);
    let state: tauri::State<'_, SharedSidecar> = app.state();
    {
        let mut s = state.inner().lock().unwrap();
        s.bypass_scan_once = true;
    }
    let shared = state.inner().clone();
    let port = sidecar::spawn_sidecar(&app, shared).await?;
    sidecar::load_studio_url(&app, port)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 0832 T-012: Window > Studio Instances submenu IPC surface.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct StudioInstanceRow {
    pub pid: u32,
    pub port: u16,
    pub source: String,
    pub source_short: String,
    pub started_at: String,
    pub is_self: bool,
}

#[tauri::command]
pub async fn list_studio_instances(
    state: tauri::State<'_, SharedSidecar>,
) -> Result<Vec<StudioInstanceRow>, String> {
    let self_pid = {
        let s = state.inner().lock().unwrap();
        s.pid
    };
    let records = crate::process_discovery::scan().await?;
    let rows: Vec<StudioInstanceRow> = records
        .into_iter()
        .map(|r| {
            let source_str = match r.source {
                crate::process_discovery::ProcessSource::Tauri => "tauri",
                crate::process_discovery::ProcessSource::NpxCli => "npx-cli",
                crate::process_discovery::ProcessSource::NodeDirect => "node-direct",
            };
            let short = r.source.shorthand().to_string();
            let is_self = self_pid == Some(r.pid)
                || matches!(r.source, crate::process_discovery::ProcessSource::Tauri);
            StudioInstanceRow {
                pid: r.pid,
                port: r.port,
                source: source_str.to_string(),
                source_short: short,
                started_at: r.started_at,
                is_self,
            }
        })
        .collect();
    Ok(rows)
}

#[tauri::command]
pub async fn switch_to_studio_instance(app: AppHandle, port: u16) -> Result<(), String> {
    sidecar::load_studio_url(&app, port)
}

#[tauri::command]
pub async fn stop_studio_instance(pid: u32) -> Result<(), String> {
    // 0832 F-005: only kill PIDs we discovered as studio instances. A
    // compromised renderer (e.g., an XSS in an embedded skill or a malicious
    // skill making fetch calls into the desktop bridge) cannot use this
    // surface to kill arbitrary user-owned processes — the scanner gate
    // ensures the pid corresponds to a real lock-file or pgrep match.
    if !pid_is_known_studio_instance(pid).await {
        log::warn!("stop_studio_instance: refused unknown pid {pid}");
        return Err(format!("pid {pid} is not a known studio instance"));
    }
    kill_external_pid(pid).await;
    Ok(())
}

/// 0832 F-005: check the scanner result set for `pid`. Returns true only if
/// `pid` corresponds to a discovered studio process (lock-file owner or
/// pgrep/proc match). Used as the defense-in-depth gate for any IPC handler
/// that signals a process by id.
async fn pid_is_known_studio_instance(pid: u32) -> bool {
    let records = match crate::process_discovery::scan().await {
        Ok(rs) => rs,
        Err(_) => return false,
    };
    records.iter().any(|r| r.pid == pid)
}

/// 0832: SIGTERM, 3s grace, SIGKILL if still alive. Delegates to the
/// shared sidecar::sigterm_with_grace helper so all kill paths in the
/// codebase use one implementation.
async fn kill_external_pid(pid: u32) {
    sidecar::sigterm_with_grace(pid, std::time::Duration::from_millis(3000)).await;
}

// ---------------------------------------------------------------------------
// 0831 auth — IPC surface for the GitHub OAuth device-flow + sign-out.
// Owned by desktop-auth-agent. Four commands, all registered at the END of
// the invoke_handler! array in lib.rs (ADD-not-REPLACE pattern per agent
// coordination contract).
//
//   start_github_device_flow   : POST /login/device/code, opens browser
//   poll_github_device_flow    : single poll iteration (caller schedules)
//   get_signed_in_user         : reads cached UserIdentity
//   sign_out                   : clear keychain token + identity cache
// ---------------------------------------------------------------------------

/// IPC payload for `start_github_device_flow`. Mirrors the production
/// `auth::DeviceCodeResponse` shape but with camelCase field names to match
/// the TypeScript bridge's expected interface (the frontend never has to
/// rename keys at the boundary).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowStartResponse {
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

/// IPC payload for `poll_github_device_flow`. The frontend treats this as
/// "either a UserIdentity (signed-in now) or one of the protocol error
/// strings". We model error states as `Err(String)` so the bridge can
/// branch on the message (`"pending"`, `"slow_down"`, `"denied"`,
/// `"expired"`, or a free-form network/parse message).

/// In-memory state held across the two-step IPC: between the first
/// `start_github_device_flow` call and subsequent `poll_github_device_flow`
/// calls we need to remember the `device_code` (which the UI must NOT see —
/// it's effectively a token-bearer). Wrapping in `Mutex<Option<...>>`
/// because there's only ever one pending sign-in attempt at a time.
#[derive(Default)]
pub struct PendingDeviceFlow {
    inner: std::sync::Mutex<Option<PendingDeviceFlowState>>,
}

struct PendingDeviceFlowState {
    client_id: String,
    device_code: zeroize::Zeroizing<String>,
    /// Polling interval the server returned (in seconds). Updated when a
    /// `slow_down` response bumps it.
    interval: u64,
}

impl PendingDeviceFlow {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Step 1 — kick off a device-flow. Returns the user_code + verification_uri
/// for the UI to display. Side effect: stashes the `device_code` in
/// `PendingDeviceFlow` state and opens the user's browser to the
/// verification URL via tauri-plugin-shell.
#[tauri::command]
pub async fn start_github_device_flow(
    app: AppHandle,
    pending: State<'_, PendingDeviceFlow>,
) -> Result<DeviceFlowStartResponse, String> {
    use crate::auth::{is_placeholder_id, request_device_code, resolve_client_id};

    let client_id = resolve_client_id();
    if is_placeholder_id(&client_id) {
        return Err(
            "OAuth client_id not configured \u{2014} set GITHUB_OAUTH_CLIENT_ID in tauri.conf.json"
                .into(),
        );
    }

    let payload = request_device_code(&client_id)
        .await
        .map_err(|e| e.to_string())?;

    // Stash device_code so subsequent poll calls find it; release any prior
    // pending flow (user retried). The lock scope is intentionally narrow —
    // the await above must NOT happen while holding it.
    {
        let mut guard = pending.inner.lock().unwrap();
        *guard = Some(PendingDeviceFlowState {
            client_id: client_id.clone(),
            device_code: zeroize::Zeroizing::new(payload.device_code.clone()),
            interval: payload.interval.max(1),
        });
    }

    // Open the verification URI in the user's default browser. We never
    // embed a webview for this — the user must see the real github.com URL
    // bar to verify they're not being phished (matches AC-US1-02 intent).
    #[allow(deprecated)]
    if let Err(e) = app.shell().open(&payload.verification_uri, None) {
        // Non-fatal: the UI still shows the URL + copy button so the user
        // can paste it manually. Log so test runs surface the issue.
        log::warn!("could not auto-open verification URL: {e}");
    }

    Ok(DeviceFlowStartResponse {
        user_code: payload.user_code,
        verification_uri: payload.verification_uri,
        interval: payload.interval,
        expires_in: payload.expires_in,
    })
}

/// Step 2 — poll once. Returns the signed-in `UserIdentity` on success.
/// Returns `Err(String)` for every non-success state:
///   - "pending"  → keep polling (callee should sleep `interval` seconds)
///   - "slow_down:<n>" → bump interval to <n>, keep polling
///   - "denied"   → user cancelled at github.com
///   - "expired"  → device_code timed out; user must restart sign-in
///   - "no-flow"  → no pending flow (caller forgot to start_github_device_flow)
///   - other       → free-form network/parse error
#[tauri::command]
pub async fn poll_github_device_flow(
    pending: State<'_, PendingDeviceFlow>,
) -> Result<crate::auth::UserIdentity, String> {
    use crate::auth::{
        clear_identity_cache, fetch_user, poll_device_flow, save_identity_cache, PollOutcome,
        TokenStore,
    };

    // Snapshot the pending state under the lock, then drop the lock before
    // awaiting any HTTP. Holding a sync Mutex across .await is a deadlock
    // shape we want to avoid even if it'd technically work in single-thread
    // tests.
    let snapshot = {
        let guard = pending.inner.lock().unwrap();
        match &*guard {
            Some(state) => Some((
                state.client_id.clone(),
                state.device_code.as_str().to_string(),
                state.interval,
            )),
            None => None,
        }
    };
    let (client_id, device_code, _interval) = match snapshot {
        Some(t) => t,
        None => return Err("no-flow".into()),
    };

    let outcome = poll_device_flow(&client_id, &device_code)
        .await
        .map_err(|e| e.to_string())?;

    match outcome {
        PollOutcome::Pending => Err("pending".into()),
        PollOutcome::SlowDown { new_interval } => {
            // Update stashed interval so the UI's next sleep honors it.
            let mut guard = pending.inner.lock().unwrap();
            if let Some(state) = guard.as_mut() {
                state.interval = new_interval.max(1);
            }
            Err(format!("slow_down:{new_interval}"))
        }
        PollOutcome::Denied => {
            pending.inner.lock().unwrap().take();
            Err("denied".into())
        }
        PollOutcome::Expired => {
            pending.inner.lock().unwrap().take();
            Err("expired".into())
        }
        PollOutcome::Granted { access_token } => {
            // Save token to keychain BEFORE clearing pending state — if save
            // fails we want the user to see a real error instead of a
            // zombied "still pending".
            let store = TokenStore::new();
            store
                .save(access_token.as_str())
                .map_err(|e| format!("keychain: {e}"))?;

            // Fetch identity now so the UI can render the dropdown with the
            // user's avatar without an extra round-trip.
            let identity = fetch_user(access_token.as_str())
                .await
                .map_err(|e| format!("identity: {e}"))?;

            // Best-effort cache write — don't fail the whole sign-in if the
            // cache file can't be written (the token is in keychain, so the
            // next launch will re-fetch identity from /user anyway).
            if let Err(e) = save_identity_cache(&identity) {
                log::warn!("could not write identity cache: {e}");
                // Non-fatal: also wipe any stale cache so we don't show a
                // mismatched login in the UI.
                let _ = clear_identity_cache();
            }

            // Clear pending state — flow complete.
            pending.inner.lock().unwrap().take();
            Ok(identity)
        }
    }
}

/// Read the cached signed-in user. Returns `Ok(None)` for a clean
/// signed-out state; never errors on a missing cache file.
#[tauri::command]
pub fn get_signed_in_user() -> Result<Option<crate::auth::UserIdentity>, String> {
    crate::auth::load_identity_cache().map_err(|e| e.to_string())
}

/// Clear keychain token + identity cache. Idempotent — calling on an
/// already-signed-out state is a no-op success. Does NOT call GitHub's
/// token revocation endpoint (deferred to a future T-008-extension); the
/// user's next sign-in will replace any leftover server-side grant.
#[tauri::command]
pub fn sign_out() -> Result<(), String> {
    use crate::auth::{clear_identity_cache, TokenStore};

    let store = TokenStore::new();
    // We swallow individual errors here so a partial state (e.g. keychain
    // entry missing but cache file present) doesn't leave the user stuck —
    // both clear paths are idempotent and best-effort by design.
    let token_err = store.clear().err();
    let cache_err = clear_identity_cache().err();
    match (token_err, cache_err) {
        (None, None) => Ok(()),
        (Some(e), _) => Err(format!("clear keychain: {e}")),
        (_, Some(e)) => Err(format!("clear identity cache: {e}")),
    }
}

// ---------------------------------------------------------------------------
// 0831 folders — get_repo_info IPC for ConnectedRepoWidget (US-004).
//
// Owned by desktop-folder-agent. Reads `auth::TokenStore::load()` to get
// the OAuth token (paid users with a token get authenticated GitHub API
// calls; free / signed-out users get unauthenticated requests with
// 60 req/h limits). The token store is OWNED by desktop-auth-agent; we
// only call its read-only `load()` method here.
//
// Lifecycle: the React widget polls this every 30s while the studio is
// active and pauses while the window is hidden. Each call shells out to
// git for the local sync state and (best-effort) hits GitHub /repos for
// the visibility check. Both calls are independent — git failure does
// not block the GitHub call and vice versa.
// ---------------------------------------------------------------------------

/// Result shape returned by `get_repo_info`. Mirrored by the React widget
/// as the source-of-truth for what's renderable in each UI state.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RepoInfo {
    /// Owner/repo (e.g. `anton-abyzov/vskill`). None if no GitHub remote.
    pub name: Option<String>,
    /// Current branch via `git branch --show-current`. None for detached HEAD.
    pub branch: Option<String>,
    /// Repo visibility from the GitHub API. `None` when:
    ///   - folder is not a github.com remote
    ///   - GitHub call failed (network, rate-limit, 404)
    ///   - user is not authenticated AND repo isn't public
    /// UI renders `None` as a neutral icon (no lock, no green check).
    pub is_private: Option<bool>,
    /// Sync state derived from `git status` + `git rev-list`.
    pub sync_state: crate::folders::SyncState,
}

#[tauri::command]
pub async fn get_repo_info(folder: String) -> Result<RepoInfo, String> {
    use std::path::Path;
    let path = Path::new(&folder);

    // Local-side detection — runs synchronously but is fast (single git
    // shellout per call, each with a 5s timeout). We do this on a blocking
    // thread so the IPC reactor isn't tied up if git stalls.
    let path_owned = path.to_path_buf();
    let local = tokio::task::spawn_blocking(move || {
        let remote = crate::folders::detect_remote(&path_owned);
        let sync = crate::folders::detect_sync_state(&path_owned);
        (remote, sync)
    })
    .await
    .map_err(|e| format!("git probe panicked: {e}"))?;
    let (remote, sync_state) = local;

    let Some(remote) = remote else {
        // Not a github.com remote — return what we have (no name, no
        // visibility, just the sync state for "Local-only" / "External
        // git" rendering on the UI side).
        return Ok(RepoInfo {
            name: None,
            branch: None,
            is_private: None,
            sync_state,
        });
    };
    let owner = remote.owner.clone();
    let repo = remote.repo.clone();
    let branch = Some(remote.branch.clone());
    let name = Some(format!("{}/{}", owner, repo));

    // Visibility lookup — best-effort. If the user is signed in we use
    // their OAuth token for higher rate limits + private-repo access.
    // Without a token, we fall through to unauth GitHub API which only
    // sees public repos (404 for private). Both paths swallow errors and
    // return is_private=None on failure (UI renders neutral icon).
    let is_private = match crate::auth::TokenStore::new().load() {
        Ok(Some(token)) => {
            let token_str: &str = token.as_str();
            fetch_repo_visibility(&owner, &repo, Some(token_str)).await
        }
        // No token: unauth call still works for public repos.
        Ok(None) | Err(_) => fetch_repo_visibility(&owner, &repo, None).await,
    };

    Ok(RepoInfo {
        name,
        branch,
        is_private,
        sync_state,
    })
}

/// Hit `GET https://api.github.com/repos/{owner}/{repo}` and return the
/// `private` field. Returns `None` for any failure (network, 404, 403
/// rate-limit, parse). 403 with `X-RateLimit-Remaining: 0` is logged at
/// warn level so we can spot rate-limit pressure in user logs.
async fn fetch_repo_visibility(owner: &str, repo: &str, token: Option<&str>) -> Option<bool> {
    use std::time::Duration;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .user_agent(concat!("vskill-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}");
    let mut req = client
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {t}"));
    }
    let resp = req.send().await.ok()?;
    let status = resp.status();
    if status.as_u16() == 403 {
        // Rate-limit signal — best-effort log; UI keeps working.
        if resp
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|v| v.to_str().ok())
            == Some("0")
        {
            log::warn!("GitHub /repos rate-limited for {owner}/{repo}");
        }
        return None;
    }
    if !status.is_success() {
        return None;
    }

    #[derive(serde::Deserialize)]
    struct RepoMeta {
        private: bool,
    }
    let meta: RepoMeta = resp.json().await.ok()?;
    Some(meta.private)
}

// ---------------------------------------------------------------------------
// 0831 quota — IPC surface for server-authoritative quota + paywall + tier
// gates. Owned by desktop-quota-agent. ADD-not-REPLACE per coordination.
//
//   quota_get               : read the disk-backed cache (no network).
//   quota_force_sync(fresh) : on-demand refresh — used by the paywall race-
//                              resolution path AND any "Sync now" button.
//                              `fresh=true` busts the platform's KV cache
//                              via `?fresh=1`.
//   quota_can_create_skill  : pre-paywall short-circuit. Returns the cached
//                              tier + the locally-counted usage. The UI does
//                              NOT trust this for enforcement — it only uses
//                              the response to decide whether to do a
//                              server-authoritative check before persisting.
//   quota_report_count      : best-effort POST telemetry of the local count.
//   open_external_url       : thin shim over tauri-plugin-shell for the
//                              UpgradeButton + GitHub-App-install handoff.
//   refresh_user_identity   : T-026 — re-fetches `/user` and updates the
//                              cached UserIdentity. Caller invokes after
//                              GitHub App install completes so the new
//                              installation_id is reflected.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    /// Cached server response, or null when no sync has happened yet.
    pub cache: Option<crate::quota::cache::QuotaCache>,
    /// Locally-counted skill total (independent of the server's count).
    pub local_skill_count: i64,
    /// Whether the cache is within the offline grace window.
    pub is_fresh: bool,
    /// Days remaining inside the grace window. Negative = stale.
    pub days_remaining: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaCanCreateResult {
    /// Whether the create should be hard-blocked client-side.
    pub blocked: bool,
    /// Reason string for telemetry / UI copy. One of:
    ///   "ok" | "limit-reached" | "no-cache-and-signed-out".
    pub reason: String,
    /// Snapshot the UI uses to render the paywall context.
    pub snapshot: QuotaSnapshot,
}

fn build_snapshot(project_roots: Vec<std::path::PathBuf>) -> QuotaSnapshot {
    let cache = crate::quota::cache::load_quota_cache().ok().flatten();
    let local_skill_count = crate::quota::count::count_local_skills(&project_roots).unwrap_or(0);
    let now_iso = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| {
            // Reuse the formatter idea via a small inline ISO-ize. We can't
            // call sync::format_unix_to_iso (private). Use chrono-free
            // emission: the cache.rs parser accepts `YYYY-MM-DDTHH:MM:SSZ`.
            let secs = d.as_secs() as i64;
            unix_to_iso(secs, d.subsec_millis())
        })
        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_string());
    let (is_fresh, days_remaining) = match &cache {
        Some(c) => (c.is_fresh(&now_iso), c.days_remaining(&now_iso)),
        None => (false, 0),
    };
    QuotaSnapshot {
        cache,
        local_skill_count,
        is_fresh,
        days_remaining,
    }
}

/// Module-private ISO formatter — duplicate of sync::format_unix_to_iso so
/// commands.rs doesn't need a pub-level one in sync.rs. Kept tiny and
/// dependency-free.
fn unix_to_iso(secs: i64, ms: u32) -> String {
    let z = secs.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month: i64 = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    let secs_of_day = secs.rem_euclid(86400);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{ms:03}Z"
    )
}

#[tauri::command]
pub async fn quota_get(project_roots: Option<Vec<String>>) -> Result<QuotaSnapshot, String> {
    let roots = project_roots
        .unwrap_or_default()
        .into_iter()
        .map(std::path::PathBuf::from)
        .collect::<Vec<_>>();
    Ok(build_snapshot(roots))
}

#[tauri::command]
pub async fn quota_force_sync(
    app: AppHandle,
    fresh: Option<bool>,
    project_roots: Option<Vec<String>>,
) -> Result<QuotaSnapshot, String> {
    let fresh = fresh.unwrap_or(false);
    // Run the GET with a hard 5s budget per plan.md §NFR. The 10s reqwest
    // timeout is the upper bound; the select! caps the wait the IPC caller
    // sees.
    let sync_fut = crate::quota::sync::force_sync(app, fresh);
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(5));
    tokio::pin!(sync_fut);
    tokio::pin!(timeout);
    tokio::select! {
        result = &mut sync_fut => {
            match result {
                Ok(_cache) => {}
                Err(crate::quota::sync::QuotaSyncError::NotSignedIn) => {
                    // Caller treated as signed-out — cache may be stale; we
                    // still return the snapshot so the UI can render the
                    // sign-in CTA without an extra round-trip.
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        _ = &mut timeout => {
            // Budget exceeded — caller decides whether to fall back to
            // cached state. Returning Ok(snapshot) preserves UX flow.
            log::warn!("quota_force_sync: 5s budget exceeded");
        }
    }
    let roots = project_roots
        .unwrap_or_default()
        .into_iter()
        .map(std::path::PathBuf::from)
        .collect::<Vec<_>>();
    Ok(build_snapshot(roots))
}

#[tauri::command]
pub async fn quota_can_create_skill(
    project_roots: Option<Vec<String>>,
) -> Result<QuotaCanCreateResult, String> {
    let roots = project_roots
        .unwrap_or_default()
        .into_iter()
        .map(std::path::PathBuf::from)
        .collect::<Vec<_>>();
    let snapshot = build_snapshot(roots);

    let (blocked, reason) = match &snapshot.cache {
        Some(c) if c.response.tier.is_paid() => (false, "ok".to_string()),
        Some(c) => {
            // Free tier with cache — gate by SERVER's count, not local.
            // Local count is informational; the server is the truth source
            // (ADR-0831-04). Compare server's count against its own limit.
            let limit = c.response.skill_limit.unwrap_or(50);
            if c.response.skill_count >= limit {
                (true, "limit-reached".to_string())
            } else {
                (false, "ok".to_string())
            }
        }
        None => {
            // No cache + no token → signed-out. UI should prompt sign-in
            // BEFORE attempting create. Treat as not-blocked here since the
            // server-side authoring route will reject via its own auth gate
            // (or, in this v1, simply allow up to the local 50 cap).
            (false, "no-cache-and-signed-out".to_string())
        }
    };

    Ok(QuotaCanCreateResult {
        blocked,
        reason,
        snapshot,
    })
}

#[tauri::command]
pub async fn quota_report_count(skill_count: i64) -> Result<(), String> {
    match crate::quota::sync::report_count(skill_count).await {
        Ok(()) => Ok(()),
        Err(crate::quota::sync::QuotaSyncError::NotSignedIn) => {
            // Best-effort — silently no-op on signed-out state.
            Ok(())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    // Restrict to https:// to avoid weaponizing this surface — a renderer
    // exploit could otherwise smuggle `file://` paths or `javascript:`
    // URIs. Tauri's allowlist also gates this, but defense-in-depth.
    if !url.starts_with("https://") {
        return Err(format!("refused non-https URL: {url}"));
    }
    #[allow(deprecated)]
    app.shell()
        .open(&url, None)
        .map_err(|e| format!("could not open {url}: {e}"))
}

/// T-026: re-fetch `/user` from GitHub using the keychain token and update
/// the on-disk identity cache. The frontend calls this after a GitHub App
/// install handoff so the next render reflects the new installation_id.
///
/// Returns the refreshed identity, or null when there's no token.
#[tauri::command]
pub async fn refresh_user_identity() -> Result<Option<crate::auth::UserIdentity>, String> {
    use crate::auth::{fetch_user, save_identity_cache, TokenStore};

    let store = TokenStore::new();
    let token = match store.load() {
        Ok(Some(t)) => t,
        Ok(None) => return Ok(None),
        Err(e) => return Err(format!("keychain: {e}")),
    };
    let identity = fetch_user(token.as_str())
        .await
        .map_err(|e| format!("github /user: {e}"))?;
    if let Err(e) = save_identity_cache(&identity) {
        log::warn!("save_identity_cache after refresh: {e}");
    }
    Ok(Some(identity))
}

// ---------------------------------------------------------------------------
// 0832 F-006: tests for the testable, IPC-handler-adjacent helpers.
//
// The Tauri command surface itself (`#[tauri::command]` async fns) needs a
// real `AppHandle` to instantiate, which requires a full tauri::Builder. We
// don't run that under cargo test (it'd need a display server / event loop).
// Instead we cover the pure-Rust helpers that the IPC handlers compose:
//   - `pid_is_known_studio_instance` — F-005 defense; gates kill calls
//   - `StudioInstanceRow` shape — what the Window > Studio Instances UI reads
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pid_is_known_studio_instance_rejects_unrelated_pid() {
        // PID 1 is `init`/`launchd`. It will never be in the discovered studio
        // process set — the helper must refuse it. This is the core F-005
        // defense: a compromised renderer cannot trick the kill path into
        // signalling arbitrary user processes.
        assert!(!pid_is_known_studio_instance(1).await);
    }

    #[tokio::test]
    async fn pid_is_known_studio_instance_rejects_zero() {
        // PID 0 is the kernel scheduler / init group on most Unixes; never a
        // valid studio instance.
        assert!(!pid_is_known_studio_instance(0).await);
    }

    #[test]
    fn studio_instance_row_serializes_with_snake_case_fields() {
        // The InstancesApp.tsx normalize() reads snake_case keys
        // (source_short, started_at, is_self). If anyone adds
        // `#[serde(rename_all = "camelCase")]` later, this test fails — they
        // must update the React side at the same time.
        let row = StudioInstanceRow {
            pid: 4321,
            port: 7077,
            source: "npx-cli".into(),
            source_short: "npx".into(),
            started_at: "2026-05-07T19:00:00Z".into(),
            is_self: false,
        };
        let json = serde_json::to_string(&row).expect("serialize");
        assert!(json.contains("\"source_short\":\"npx\""));
        assert!(json.contains("\"started_at\":\"2026-05-07T19:00:00Z\""));
        assert!(json.contains("\"is_self\":false"));
        assert!(json.contains("\"pid\":4321"));
        assert!(json.contains("\"port\":7077"));
    }
}
