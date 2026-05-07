// Tauri commands invokable from the studio frontend (or internal callers).
// Phase-1 surface: get_server_port, restart_server, open_logs_folder, quit.
// 0830 Phase 1 surface: settings + updater + autostart + preferences-window
// stubs (placeholder errors until downstream agents implement).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::ShellExt;

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
