// Preferences window — lazy-create / focus-existing.
//
// Per ADR 0830-01 we ship a separate Tauri `WebviewWindow` (not a modal in the
// main window) for the desktop Preferences UI. The window is created on demand
// the first time the user invokes `Skill Studio → Preferences…` (Cmd+,) — not
// pre-declared in tauri.conf.json — so that the +~30 MB WKWebView/WebView2
// process cost is only paid by users who actually open Preferences. Subsequent
// invocations focus the existing window via the O(1) label lookup
// (`Manager::get_webview_window("preferences")`).
//
// Spec ACs satisfied here: AC-US1-03 (720×540 non-resizable, centred),
// AC-US1-04 (focus existing — no second instance), AC-US1-05 (lifecycle is
// independent of main; close just hides per Mac convention).
//
// The URL `WebviewUrl::App("preferences.html".into())` resolves against
// `frontendDist` (= `../dist/eval-ui` per tauri.conf.json `build.frontendDist`).
// Vite multi-entry build emits `dist/eval-ui/preferences.html` (root-level, not
// nested under a `preferences/` folder), matching `src/eval-ui/preferences.html`.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label used everywhere we look up the Preferences window. Kept as a
/// module-level const so menu wiring, lifecycle teardown, and capability
/// scoping all reference the same string.
pub const PREFERENCES_LABEL: &str = "preferences";

/// Open the Preferences window — focus it if it already exists, otherwise
/// create it. `tab` (e.g. `Some("updates")`) is forwarded to the existing
/// window via the `preferences-select-tab` event so the user can deeplink
/// from `Skill Studio → Check for Updates…` (AC-US3-07). The freshly-created
/// path encodes the tab in the URL query string so the React bundle can
/// pick it up before its first paint.
pub fn open_preferences(app: &AppHandle, tab: Option<&str>) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(PREFERENCES_LABEL) {
        // Already open. Focus it (handles both the "minimized to dock" and
        // "obscured behind main window" cases) and forward the tab hint so
        // the React layer can switch panels without a remount.
        let _ = existing.unminimize();
        let _ = existing.show();
        existing
            .set_focus()
            .map_err(|e| format!("set_focus(preferences): {e}"))?;
        if let Some(tab_id) = tab {
            // emit_to is used in lib.rs/menu.rs already; we use the Window's
            // emit() which scopes to that window's webview.
            use tauri::Emitter;
            let _ = existing.emit("preferences-select-tab", tab_id);
        }
        return Ok(());
    }

    let url_path = match tab {
        Some(t) if !t.is_empty() => format!("preferences.html?tab={t}"),
        _ => "preferences.html".to_string(),
    };

    WebviewWindowBuilder::new(app, PREFERENCES_LABEL, WebviewUrl::App(url_path.into()))
        .title("Skill Studio — Preferences")
        // Spec AC-US1-03: 720×540 non-resizable. (Plan §3.6 wireframe says
        // 720×560 — we honor the spec value here; the 20px delta is in the
        // chrome and content padding adjusts.)
        .inner_size(720.0, 540.0)
        .resizable(false)
        .minimizable(true)
        .maximizable(false)
        .fullscreen(false)
        .center()
        .always_on_top(false)
        .decorations(true)
        .focused(true)
        .visible(true)
        .build()
        .map_err(|e| format!("WebviewWindowBuilder(preferences): {e}"))?;

    Ok(())
}
