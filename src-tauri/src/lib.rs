// Library entrypoint shared by `cargo tauri` (desktop) and any future mobile
// runner. Keeps the bin thin and lets `cargo test` exercise pure-Rust logic.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Manager, RunEvent, RESTART_EXIT_CODE};
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
// Cross-platform PID liveness / termination / parent lookup (Win32 on
// Windows, libc on Unix). Shared by sidecar.rs and process_discovery.
mod proc;
// 0831 quota — server-authoritative quota cache + 1h background sync + force_sync IPC.
// Owned by desktop-quota-agent (impl-0831-enterprise team). Surface lives behind
// the `commands::quota_*` IPCs registered below + the Tauri event `quota://updated`.
mod quota;
mod sidecar;

use sidecar::{SharedSidecar, SidecarState};

static EXIT_CLEANUP_DONE: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: SharedSidecar = Arc::new(Mutex::new(SidecarState::default()));
    sidecar::install_termination_signal_handler();

    tauri::Builder::default()
        .plugin(build_log_plugin())
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
            commands::restart_app,
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
                            let html = boot_failure_page(
                                &e,
                                &log_file_path(),
                                &sidecar::last_stderr(&boot_state),
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
            // async shutdown to completion (POST /api/shutdown -> SIGTERM ->
            // SIGKILL), then re-issue normal exits once cleanup has completed.
            // Restart exits cannot be prevented by Tauri; block in-place and
            // let Tauri's restart_on_exit path relaunch after RunEvent::Exit.
            RunEvent::ExitRequested { api, code, .. } => {
                if !mark_exit_cleanup_started() {
                    return;
                }

                let restart_requested = is_restart_exit(code);
                if !restart_requested {
                    api.prevent_exit();
                }

                let app_clone = app.clone();
                let shutdown_state = app_clone.state::<SharedSidecar>().inner().clone();
                tauri::async_runtime::block_on(async move {
                    sidecar::graceful_shutdown(shutdown_state).await;
                });

                if !restart_requested {
                    app_clone.exit(code.unwrap_or(0));
                }
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

/// File + (debug) stdout logging into `commands::log_dir()` — the same folder
/// the "Show Logs" menu item opens. Rotates at 10 MiB keeping one backup.
/// Before this, env_logger wrote to stderr, which `windows_subsystem =
/// "windows"` and Finder-launched .app bundles discard, so the log folder was
/// always empty and the failure page pointed at a macOS path on every OS.
fn build_log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let mut targets = vec![Target::new(TargetKind::Folder {
        path: commands::log_dir(),
        file_name: Some(LOG_FILE_STEM.into()),
    })];
    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .level(log::LevelFilter::Info)
        .max_file_size(10 * 1024 * 1024)
        .rotation_strategy(RotationStrategy::KeepOne)
        .build()
}

const LOG_FILE_STEM: &str = "vskill";

fn log_file_path() -> std::path::PathBuf {
    commands::log_dir().join(format!("{LOG_FILE_STEM}.log"))
}

/// HTML for the boot-failure page: the error, the real per-OS log file and
/// the sidecar's last stderr lines (the actual reason it died).
fn boot_failure_page(error: &str, log_file: &std::path::Path, stderr_tail: &[String]) -> String {
    let stderr_block = if stderr_tail.is_empty() {
        String::new()
    } else {
        format!(
            "<p>Last output from the server process:</p>\
             <pre style=\"white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:6px\">{}</pre>",
            html_escape(&stderr_tail.join("\n"))
        )
    };
    format!(
        "<html><body style=\"font:14px -apple-system,system-ui,sans-serif;padding:32px;max-width:720px\">\
         <h2>Skill Studio failed to start</h2><p>{}</p>{}\
         <p>Log file: <code>{}</code></p></body></html>",
        html_escape(error),
        stderr_block,
        html_escape(&log_file.display().to_string())
    )
}

fn is_restart_exit(code: Option<i32>) -> bool {
    code == Some(RESTART_EXIT_CODE)
}

fn mark_exit_cleanup_started() -> bool {
    EXIT_CLEANUP_DONE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    static EXIT_CLEANUP_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn restart_exit_code_is_detected() {
        assert!(is_restart_exit(Some(RESTART_EXIT_CODE)));
        assert!(!is_restart_exit(Some(0)));
        assert!(!is_restart_exit(None));
    }

    #[test]
    fn boot_failure_page_shows_log_path_and_stderr_tail() {
        let page = boot_failure_page(
            "sidecar exited before announcing port (exit code 1)",
            std::path::Path::new("C:\\Users\\a\\AppData\\Local\\vSkill\\Logs\\vskill.log"),
            &["SyntaxError: Unexpected end of input".to_string(), "<x>".to_string()],
        );
        assert!(page.contains("exit code 1"));
        assert!(page.contains("AppData\\Local\\vSkill\\Logs\\vskill.log"));
        assert!(page.contains("SyntaxError: Unexpected end of input"));
        assert!(page.contains("&lt;x&gt;"), "stderr must be HTML-escaped: {page}");
        assert!(!page.contains("~/Library/Logs"));

        let bare = boot_failure_page("x", std::path::Path::new("/tmp/vskill.log"), &[]);
        assert!(!bare.contains("<pre"));
    }

    #[test]
    fn exit_cleanup_runs_once() {
        let _guard = EXIT_CLEANUP_TEST_LOCK.lock().unwrap();
        EXIT_CLEANUP_DONE.store(false, Ordering::SeqCst);

        assert!(mark_exit_cleanup_started());
        assert!(!mark_exit_cleanup_started());

        EXIT_CLEANUP_DONE.store(false, Ordering::SeqCst);
    }
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
