// Window lifecycle: close → hide (Mac convention), persist {x, y, w, h, fullscreen}
// in LOGICAL points (display-independent) to ~/.vskill/desktop-window-state.json.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Position, Size, WebviewWindow, WindowEvent,
};

const STATE_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    /// Schema version. v1 (missing/0/1) was physical pixels and is discarded.
    /// v2 onward stores logical points (display-independent).
    #[serde(default)]
    pub version: u32,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    #[serde(default)]
    pub is_full_screen: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            x: None,
            y: None,
            width: None,
            height: None,
            is_full_screen: false,
        }
    }
}

const DEFAULT_W: f64 = 1280.0;
const DEFAULT_H: f64 = 800.0;
const MIN_W: f64 = 900.0;
const MIN_H: f64 = 600.0;

pub fn restore(window: &WebviewWindow) {
    let state = load().unwrap_or_default();

    let (w, h) = match (state.width, state.height) {
        (Some(w), Some(h)) => (w.max(MIN_W), h.max(MIN_H)),
        _ => (DEFAULT_W, DEFAULT_H),
    };
    let _ = window.set_size(Size::Logical(LogicalSize::new(w, h)));

    if let (Some(x), Some(y)) = (state.x, state.y) {
        let _ = window.set_position(Position::Logical(LogicalPosition::new(x, y)));
    } else {
        let _ = window.center();
    }
    if state.is_full_screen {
        let _ = window.set_fullscreen(true);
    }
}

pub fn attach_handlers(window: &WebviewWindow) {
    let win_for_close = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            // Mac convention: red traffic light hides, doesn't quit.
            api.prevent_close();
            persist_from_window(&win_for_close);
            let _ = win_for_close.hide();
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            persist_from_window(&win_for_close);
        }
        _ => {}
    });
}

pub fn show_or_create(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn persist_from_window(window: &WebviewWindow) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let mut state = WindowState::default();

    if let Ok(size) = window.outer_size() {
        let logical = size.to_logical::<f64>(scale);
        state.width = Some(logical.width);
        state.height = Some(logical.height);
    }
    if let Ok(pos) = window.outer_position() {
        let logical = pos.to_logical::<f64>(scale);
        state.x = Some(logical.x);
        state.y = Some(logical.y);
    }
    state.is_full_screen = window.is_fullscreen().unwrap_or(false);
    save(&state);
}

fn state_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|h| h.join(".vskill").join("desktop-window-state.json"))
}

fn load() -> Option<WindowState> {
    let path = state_path()?;
    let bytes = std::fs::read(&path).ok()?;
    let state: WindowState = serde_json::from_slice(&bytes).ok()?;

    // v1 stored physical pixels and was display-dependent. Discard rather than
    // attempt migration — pre-release, no real users.
    if state.version < STATE_VERSION {
        let _ = std::fs::remove_file(&path);
        return None;
    }
    Some(state)
}

fn save(state: &WindowState) {
    let Some(path) = state_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(json) = serde_json::to_vec_pretty(state) {
        if std::fs::write(&tmp, &json).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}
