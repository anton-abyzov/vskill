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

#[tauri::command]
pub async fn pick_default_project_folder(app: AppHandle) -> Result<Option<String>, String> {
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
    rx.await.map_err(|e| format!("folder picker channel closed: {e}"))
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
