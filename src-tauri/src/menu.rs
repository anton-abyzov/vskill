// Native macOS menu bar — Skill Studio / File / Edit / View / Window / Help.
// Wired via Tauri 2's menu API, with platform-appropriate accelerators.

use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let pkg = app.package_info();
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some(String::from("Skill Studio")))
        .version(Some(pkg.version.to_string()))
        .copyright(Some(String::from("Copyright © 2026 Anton Abyzov")))
        .website(Some(String::from("https://verified-skill.com")))
        .website_label(Some(String::from("verified-skill.com")))
        .build();

    // Skill Studio submenu (App menu — only meaningful on macOS, Tauri ignores on others).
    // macOS HIG: Preferences… sits under the app menu with the Cmd+, accelerator
    // (AC-US1-01). On Win/Linux we additionally surface it under Edit (see below).
    let app_submenu = SubmenuBuilder::new(app, "Skill Studio")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Skill Studio"),
            Some(about_metadata),
        )?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("check_for_updates", "Check for Updates...")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("quit_vskill", "Quit Skill Studio")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?,
        )
        .build()?;

    // File menu.
    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("open_project", "Open Project...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close_window", "Close Window")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .build()?;

    // Edit menu — standard system items. On Win/Linux we additionally append
    // Preferences here (AC-US1-02), since those platforms have no app menu and
    // users typically expect Preferences under Edit (Chromium/Slack/VS Code
    // convention). On macOS the Preferences item lives in the app menu only.
    let mut edit_builder = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?);
    if !cfg!(target_os = "macos") {
        edit_builder = edit_builder.separator().item(
            &MenuItemBuilder::with_id("preferences", "Preferences...")
                .accelerator("Ctrl+,")
                .build(app)?,
        );
    }
    let edit_submenu = edit_builder.build()?;

    // View menu — Reload + DevTools (DevTools omitted from release builds).
    let mut view_builder = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("reload", "Reload")
                .accelerator("CmdOrCtrl+R")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("force_reload", "Force Reload")
                .accelerator("CmdOrCtrl+Shift+R")
                .build(app)?,
        );
    if cfg!(debug_assertions) {
        view_builder = view_builder.item(
            &MenuItemBuilder::with_id("toggle_devtools", "Toggle Developer Tools")
                .accelerator("CmdOrCtrl+Alt+I")
                .build(app)?,
        );
    }
    let view_submenu = view_builder
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // Window menu — adds a "Studio Instances" item that opens the modal
    // listing every detected studio instance (T-012). The submenu itself is
    // built dynamically when clicked (event handler in handle_event) so the
    // list is always fresh — no polling.
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("studio_instances", "Studio Instances...")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    // Help menu.
    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::with_id("show_logs", "Show Logs")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("restart_server", "Restart Server")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("about_vskill", "About Skill Studio")
                .build(app)?,
        )
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()
}

pub fn handle_event(app: &AppHandle, id: &str) {
    match id {
        "quit_vskill" => {
            app.exit(0);
        }
        "close_window" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
        }
        "reload" => {
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(url) = w.url() {
                    let _ = w.navigate(url);
                }
            }
        }
        "force_reload" => {
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(url) = w.url() {
                    let _ = w.navigate(url);
                }
            }
        }
        "toggle_devtools" => {
            #[cfg(debug_assertions)]
            if let Some(w) = app.get_webview_window("main") {
                if w.is_devtools_open() {
                    w.close_devtools();
                } else {
                    w.open_devtools();
                }
            }
        }
        "show_logs" => {
            crate::commands::open_logs_folder_inner(app);
        }
        "restart_server" => {
            crate::commands::restart_server_inner(app.clone());
        }
        "open_project" => {
            // Phase 1 stub — phase 2 wires the NSOpenPanel picker.
            let _ = app.emit_to(
                "main",
                "menu-action",
                serde_json::json!({ "action": "open_project" }),
            );
        }
        "preferences" => {
            // ⌘, opens the Preferences window with no preselected tab.
            // Errors are logged but not surfaced — a failure here means the
            // capability is misconfigured (a build-time bug, not user-facing).
            if let Err(e) = crate::preferences::window::open_preferences(app, None) {
                log::error!("open_preferences failed: {e}");
            }
        }
        "check_for_updates" => {
            // Per AC-US3-07: open Preferences directly on the Updates tab and
            // emit `preferences-trigger-check` so the React layer kicks the
            // updater check as soon as the tab paints. The trigger event is
            // emitted regardless of whether we created a new window or focused
            // an existing one — the open helper already routed the tab hint.
            if let Err(e) =
                crate::preferences::window::open_preferences(app, Some("updates"))
            {
                log::error!("open_preferences(updates) failed: {e}");
                return;
            }
            if let Some(prefs) =
                app.get_webview_window(crate::preferences::window::PREFERENCES_LABEL)
            {
                let _ = prefs.emit("preferences-trigger-check", ());
            }
        }
        "about_vskill" => {
            let _ = app.emit_to(
                "main",
                "menu-action",
                serde_json::json!({ "action": id }),
            );
        }
        "studio_instances" => {
            // 0832 T-012: open a dedicated window that lists every detected
            // studio instance. The submenu UI lives in src/eval-ui/src/lifecycle/
            // and uses the list_studio_instances IPC handler. Refreshes on
            // every open (no polling, as required by AC-US3-04).
            if let Err(e) = open_studio_instances_window(app) {
                log::error!("studio_instances window open failed: {e}");
            }
        }
        _ => {
            log::debug!("unhandled menu id: {id}");
        }
    }
}

/// 0832 T-012: open a 540x420 instances window. Same lifecycle.html entry
/// point + a query param that switches the React app into instances-list mode.
///
/// 0832 F-GRILL-02: when the window is reused (already exists, just hidden),
/// emit a `studio-instances://refresh` event so the React layer re-runs
/// `list_studio_instances`. Without this, reopening shows stale rows from the
/// last time the window was visible. AC-US3-04 says "refreshes within 1s of
/// being opened" — a stale list breaks that contract.
fn open_studio_instances_window(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
    const LABEL: &str = "studio_instances";
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        // Tell the renderer to re-fetch. Non-fatal if the listener isn't ready
        // yet — the InstancesApp also refreshes on mount, so a fresh window
        // load gets fresh data either way.
        let _ = existing.emit("studio-instances://refresh", ());
        return Ok(());
    }
    let url = WebviewUrl::App("lifecycle.html?mode=instances".into());
    WebviewWindowBuilder::new(app, LABEL, url)
        .title("Studio Instances")
        .inner_size(540.0, 420.0)
        .min_inner_size(540.0, 360.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()?;
    Ok(())
}
