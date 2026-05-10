// Library entrypoint shared by `cargo tauri` (desktop) and any future mobile
// runner. Keeps the bin thin and lets `cargo test` exercise pure-Rust logic.

use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

// 0831 auth — GitHub OAuth device-flow + secure token storage.
// Owned by desktop-auth-agent (impl-0831-enterprise team). Surface lives
// behind the `commands::auth_*` IPCs registered below.
mod auth;
// 0834 account — IPC surface for the /account WebView. Reads the keyring
// token and exposes the platform URL so AccountContext on the JS side
// can produce `Authorization: Bearer …` headers.
mod account;
mod commands;
// 0831 folders — smart folder picker + connected-repo widget.
// Owned by desktop-folder-agent (impl-0831-enterprise team). Surface lives
// behind the `commands::pick_default_project_folder` (extended) +
// `commands::get_repo_info` IPCs registered below.
mod folders;
mod lifecycle;
// 0832 lifecycle modal — opens a 720x320 WebviewWindow when the scanner
// detects a running external studio instance at boot.
mod lifecycle_modal;
mod menu;
mod preferences;
// 0832 process discovery — enumerate running studio instances via
// ~/.vskill/runtime/*.lock + platform-native fallback (lsof / /proc / pwsh).
mod process_discovery;
// 0831 quota — server-authoritative quota cache + 1h background sync + force_sync IPC.
// Owned by desktop-quota-agent (impl-0831-enterprise team). Surface lives behind
// the `commands::quota_*` IPCs registered below + the Tauri event `quota://updated`.
mod quota;
mod sidecar;

use sidecar::{SharedSidecar, SidecarState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .try_init();

    let state: SharedSidecar = Arc::new(Mutex::new(SidecarState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Bring the running window forward when a second launch is attempted.
            lifecycle::show_or_create(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin({
            let mut b = tauri_plugin_autostart::Builder::new()
                .args(vec!["--minimized"]);
            #[cfg(target_os = "macos")]
            {
                b = b.macos_launcher(MacosLauncher::LaunchAgent);
            }
            b.build()
        })
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            commands::get_server_port,
            // 0836 US-002 — per-process X-Studio-Token bridge for the
            // WebView. The token is captured from the sidecar's startup
            // banner; the IPC returns None until that arrives.
            commands::get_studio_token,
            commands::restart_server,
            commands::open_logs_folder,
            commands::quit,
            commands::get_settings,
            commands::set_setting,
            commands::reset_settings,
            commands::check_for_updates,
            commands::download_and_install_update,
            commands::cancel_update,
            commands::open_preferences,
            commands::get_app_metadata,
            commands::set_autostart,
            commands::pick_default_project_folder,
            commands::reveal_settings_file,
            // 0832 lifecycle modal IPC surface.
            commands::get_detected_instance,
            commands::lifecycle_use_existing,
            commands::lifecycle_stop_existing,
            commands::lifecycle_run_alongside,
            // 0832 Window > Studio Instances submenu IPC surface.
            commands::list_studio_instances,
            commands::switch_to_studio_instance,
            commands::stop_studio_instance,
            // 0831 auth — GitHub OAuth device-flow + sign-out (4 commands).
            // ADD-not-REPLACE per agent coordination contract: appended at
            // the END of the array so concurrent agents editing this file
            // produce additive diffs instead of conflicts.
            commands::start_github_device_flow,
            commands::poll_github_device_flow,
            commands::get_signed_in_user,
            commands::sign_out,
            // 0831 folders — connected-repo widget + folder picker
            // classification (US-003 + US-004). Owned by
            // desktop-folder-agent. `pick_default_project_folder` is
            // already registered above; this entry adds the widget feed.
            commands::get_repo_info,
            // 0831 quota — server-authoritative quota cache + paywall
            // gating (US-005, US-007, US-008, US-010). Owned by
            // desktop-quota-agent. ADD-not-REPLACE per coordination.
            commands::quota_get,
            commands::quota_force_sync,
            commands::quota_can_create_skill,
            commands::quota_report_count,
            commands::open_external_url,
            commands::refresh_user_identity,
            // 0834 account — IPC for the /account WebView (US-012).
            // 0836 US-003: account_get_token REMOVED — XSS escalation
            // path. Replaced with account_get_user_summary which returns
            // display fields only (no token surface). Authenticated HTTP
            // flows through the eval-server platform-proxy, which holds
            // the bearer Rust-side.
            account::commands::account_get_user_summary,
            account::commands::account_get_platform_url,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Settings store: hand-rolled atomic-write JSON at ~/.vskill/settings.json.
            // Created here (not at .manage() time) because the debouncer task
            // requires a live tokio runtime, which only exists after Builder
            // boot completes.
            app.manage(preferences::SettingsStore::new());

            // Update flow: holds the US-003 state machine + cancel flag. The
            // 24h auto-check task is spawned after sidecar boot below so it
            // doesn't compete for the cold-launch budget.
            app.manage(preferences::UpdaterState::new());

            // 0831 auth: pending GitHub device-flow state. Holds the
            // `device_code` between `start_github_device_flow` and
            // `poll_github_device_flow` IPC calls so the UI never has to
            // see the device_code (it's effectively a bearer secret during
            // the polling window).
            app.manage(commands::PendingDeviceFlow::new());

            // Wire the native menu bar.
            let menu = menu::build(&handle)?;
            app.set_menu(menu)?;
            let menu_handle = handle.clone();
            app.on_menu_event(move |_app, event| {
                menu::handle_event(&menu_handle, event.id().as_ref());
            });

            // Restore window geometry + attach close-hides-window + persistence hooks.
            if let Some(window) = handle.get_webview_window("main") {
                lifecycle::restore(&window);
                lifecycle::attach_handlers(&window);
            }

            // Boot the sidecar in the background; show the main window once
            // /api/health responds. If boot fails, surface a plain dialog and
            // exit cleanly — the user's next launch is a fresh attempt.
            //
            // 0832: when the scanner detects an external studio instance,
            // spawn_sidecar returns Err("lifecycle-modal-pending"). That's
            // not a fatal failure — the lifecycle modal owns the next step.
            // The IPC handlers (lifecycle_use_existing / lifecycle_stop_existing
            // / lifecycle_run_alongside) re-drive the boot flow as needed.
            let boot_handle = handle.clone();
            let boot_state = state.clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_sidecar(&boot_handle, boot_state.clone()).await {
                    Ok(port) => {
                        if let Err(e) = sidecar::load_studio_url(&boot_handle, port) {
                            log::error!("could not load studio URL: {e}");
                        }
                    }
                    Err(ref e) if e == "lifecycle-modal-pending" => {
                        log::info!("sidecar boot deferred — lifecycle modal is up");
                    }
                    Err(e) => {
                        log::error!("sidecar boot failed: {e}");
                        if let Some(window) = boot_handle.get_webview_window("main") {
                            let html = format!(
                                "<html><body style=\"font:14px -apple-system,system-ui;padding:32px\">\
                                <h2>vSkill failed to start</h2><p>{}</p>\
                                <p>Check logs at <code>~/Library/Logs/vSkill/</code>.</p></body></html>",
                                html_escape(&e)
                            );
                            let data = format!("data:text/html;charset=utf-8,{}", urlencoding(&html));
                            if let Ok(url) = data.parse::<tauri::Url>() {
                                let _ = window.navigate(url);
                                let _ = window.show();
                            }
                        }
                    }
                }
            });

            // Auto-check task — spawns its own loop, ticks every 24h, and
            // honours settings.updates.autoCheck. Runs alongside the sidecar
            // boot so the cold-launch path is unaffected (NFR-01).
            preferences::updater::spawn_auto_check_task(handle.clone());

            // 0831 quota: spawn the 1h background sync task. Idempotent on
            // signed-out state (cheap keychain read + sleep). No-ops until
            // the user signs in.
            quota::sync::spawn_background_task(handle.clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building vSkill desktop")
        .run(move |app, event| match event {
            // ExitRequested fires BEFORE windows close. We block exit, run the
            // async shutdown to completion (POST /api/shutdown → SIGTERM →
            // SIGKILL), then re-issue exit. Without prevent_exit, the runtime
            // can return while the sidecar is mid-shutdown and leak the child.
            RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
                let app_clone = app.clone();
                let shutdown_state = app_clone.state::<SharedSidecar>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    sidecar::graceful_shutdown(shutdown_state).await;
                });
                app_clone.exit(0);
            }
            // Final catch-all — fires last, after all windows are gone. If
            // something raced past graceful_shutdown (force-quit, panic in the
            // async path), reap the sidecar PID synchronously here.
            RunEvent::Exit => {
                let shutdown_state = app.state::<SharedSidecar>().inner().clone();
                sidecar::force_kill_pid(&shutdown_state);
            }
            _ => {}
        });
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn urlencoding(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if matches!(b,
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' |
                b'-' | b'_' | b'.' | b'~' | b'/' | b':' | b'=' | b'?' | b'&' | b'#' | b';' | b','
            ) {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}
