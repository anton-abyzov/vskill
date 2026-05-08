// 0832 lifecycle modal — Phase 3.
//
// Opens a 720x320 Tauri WebviewWindow when `process_discovery::scan()` finds
// a running external studio instance at boot. The window loads
// `lifecycle.html` (built by vite) which renders the React app from
// `src/eval-ui/src/lifecycle/`. Three IPC handlers — use-existing,
// stop-existing, run-alongside — drive the post-modal control flow.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::process_discovery::ProcessRecord;

pub const LIFECYCLE_LABEL: &str = "lifecycle";

/// Open (or focus) the lifecycle modal window. Sends the detected
/// ProcessRecord on the `lifecycle://detected` event so the React layer can
/// render its body without round-tripping a separate IPC call.
pub fn open(app: &AppHandle, detected: &ProcessRecord) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LIFECYCLE_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        let _ = existing.emit("lifecycle://detected", detected);
        return Ok(());
    }

    let url = WebviewUrl::App("lifecycle.html".into());
    let window = WebviewWindowBuilder::new(app, LIFECYCLE_LABEL, url)
        .title("Skill Studio is already running")
        .inner_size(720.0, 320.0)
        .min_inner_size(720.0, 320.0)
        .resizable(false)
        .center()
        .focused(true)
        .build()
        .map_err(|e| format!("lifecycle window build failed: {e}"))?;

    // Stash the detected record so the modal's React layer can fetch it on
    // mount via the `get_detected_instance` command (race-free — emit-on-show
    // can lose the event if React hasn't mounted yet).
    crate::lifecycle_modal::DETECTED_RECORD
        .lock()
        .map_err(|e| format!("lifecycle state lock poisoned: {e}"))?
        .replace(detected.clone());

    // Emit the detected record on a dedicated event channel for any window
    // that wants to subscribe (legacy path; React uses get_detected_instance).
    let _ = window.emit("lifecycle://detected", detected);
    Ok(())
}

/// Close the modal window if it's open. Idempotent.
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LIFECYCLE_LABEL) {
        let _ = w.close();
    }
    if let Ok(mut guard) = DETECTED_RECORD.lock() {
        guard.take();
    }
}

// ---------------------------------------------------------------------------
// Shared state — the detected ProcessRecord while the modal is up. The
// IPC handlers in commands.rs read this when the user picks an action.
// ---------------------------------------------------------------------------

use std::sync::Mutex;

pub static DETECTED_RECORD: Mutex<Option<ProcessRecord>> = Mutex::new(None);

/// Set by the boot path when an external instance is detected; read by the
/// IPC handlers; cleared on modal close.
pub fn set_detected(rec: ProcessRecord) {
    if let Ok(mut g) = DETECTED_RECORD.lock() {
        *g = Some(rec);
    }
}

pub fn current_detected() -> Option<ProcessRecord> {
    DETECTED_RECORD.lock().ok().and_then(|g| g.clone())
}
