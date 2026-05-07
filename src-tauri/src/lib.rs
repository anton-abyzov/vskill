// Library entrypoint shared by `cargo tauri` (desktop) and any future mobile
// runner. Keeps the bin thin and lets `cargo test` exercise pure-Rust logic.

use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent};
#[cfg(target_os = "macos")]
use tauri_plugin_autostart::MacosLauncher;

mod commands;
mod lifecycle;
mod menu;
mod preferences;
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
            let boot_handle = handle.clone();
            let boot_state = state.clone();
            tauri::async_runtime::spawn(async move {
                match sidecar::spawn_sidecar(&boot_handle, boot_state.clone()).await {
                    Ok(port) => {
                        if let Err(e) = sidecar::load_studio_url(&boot_handle, port) {
                            log::error!("could not load studio URL: {e}");
                        }
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
