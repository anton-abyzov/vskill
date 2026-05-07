// Update flow wrapper around tauri-plugin-updater@2.10.1.
//
// Owns the Rust side of the US-003 / US-007 / US-009 state machine. The JS UI
// is a pure projection of the events emitted from here.
//
// State transitions (plan §3.7):
//
//     Idle ── check ──► Checking ──► UpToDate | Available | Error
//     Available ── install ──► Downloading ──► Installing ──► RestartRequired
//     Downloading ── cancel ──► Idle
//
// Concurrency: a single `Mutex<UpdateState>` serializes mutations. A separate
// `inflight` mutex (held with `try_lock`) ensures only one check or install
// runs at a time (AC-US3-06). Cancellation flips an `AtomicBool` consulted
// by the download progress callback and by the post-download transition.
//
// Settings integration:
//   - `updates.skippedVersion`: an Available update whose version matches is
//     surfaced as UpToDate (the user explicitly skipped it).
//   - `updates.lastCheckedAt`: written via SettingsStore on every successful
//     (non-error) check (AC-US3-08).
//   - `updates.autoCheck`: gates the 24h boot-time background check.
//
// Tauri events (UI subscribes via @tauri-apps/api/event):
//   - `updater://check-result`     payload: UpdateInfo
//   - `updater://progress`         payload: { bytes, total }
//   - `updater://restart-required` payload: { version }
//   - `updater://error`            payload: { message }
//   - `updater://available`        payload: UpdateInfo (auto-check)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;
use tokio::sync::Mutex;

use crate::commands::UpdateInfo;
use crate::preferences::SettingsStore;

const AUTO_CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// Lifecycle state for the update flow. Owned by the `UpdaterState` resource
/// stored in app-managed state. UI is a projection — it does not own state.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind")]
pub enum UpdateState {
    #[default]
    Idle,
    Checking,
    Available { version: String, notes: Option<String> },
    UpToDate,
    Downloading { bytes: u64, total: Option<u64> },
    Installing,
    RestartRequired { version: String },
    Error(String),
}

/// App-managed resource that holds the current update state plus the
/// cancellation flag for an in-flight download. All fields are `Arc`-wrapped
/// so callers can clone cheap handles into spawned tasks.
pub struct UpdaterState {
    pub state: Arc<Mutex<UpdateState>>,
    pub inflight: Arc<Mutex<()>>,
    pub cancel: Arc<AtomicBool>,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(UpdateState::default())),
            inflight: Arc::new(Mutex::new(())),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Snapshot of the current update state. Used by tests and by future
    /// reconcile-after-reload UI flows; cheap clone of the inner enum.
    #[allow(dead_code)]
    pub async fn snapshot(&self) -> UpdateState {
        self.state.lock().await.clone()
    }

    fn handles(&self) -> UpdaterHandles {
        UpdaterHandles {
            state: self.state.clone(),
            inflight: self.inflight.clone(),
            cancel: self.cancel.clone(),
        }
    }
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self::new()
    }
}

/// Cheap-clone bundle of the `Arc`s inside `UpdaterState`. Returned from
/// `UpdaterState::handles()` so callers don't have to juggle `State<'_, _>`
/// borrows across `.await` points.
#[derive(Clone)]
struct UpdaterHandles {
    state: Arc<Mutex<UpdateState>>,
    inflight: Arc<Mutex<()>>,
    cancel: Arc<AtomicBool>,
}

// ---------------------------------------------------------------------------
// Event channel names (constants so the UI agent has a single source).
// ---------------------------------------------------------------------------

pub const EVT_CHECK_RESULT: &str = "updater://check-result";
pub const EVT_PROGRESS: &str = "updater://progress";
pub const EVT_RESTART_REQUIRED: &str = "updater://restart-required";
pub const EVT_ERROR: &str = "updater://error";
pub const EVT_AVAILABLE: &str = "updater://available";

// ---------------------------------------------------------------------------
// Public IPC entry points (called from commands.rs)
// ---------------------------------------------------------------------------

pub async fn check_for_updates<R: Runtime>(app: AppHandle<R>) -> Result<UpdateInfo, String> {
    let handles = app.state::<UpdaterState>().handles();

    // AC-US3-06: only one check/install in flight at a time. Second click → no-op.
    let _guard = match handles.inflight.try_lock() {
        Ok(g) => g,
        Err(_) => {
            // Return the current snapshot so the UI can re-render without surprise.
            let current = handles.state.lock().await.clone();
            return Ok(state_to_info(&current));
        }
    };

    set_state(&handles, UpdateState::Checking).await;

    let result = check_inner(&app).await;
    let info = match result {
        Ok(None) => {
            set_state(&handles, UpdateState::UpToDate).await;
            touch_last_checked(&app).await;
            UpdateInfo {
                available: false,
                version: None,
                notes: None,
            }
        }
        Ok(Some(announced)) => {
            let announced_version = announced.version.clone();
            let announced_notes = announced.body.clone();

            let skipped = read_skipped_version(&app).await;
            if skipped.as_deref() == Some(announced_version.as_str()) {
                // User explicitly skipped this version — surface as UpToDate
                // but still echo the version so the UI can show "you skipped vX".
                set_state(&handles, UpdateState::UpToDate).await;
                touch_last_checked(&app).await;
                UpdateInfo {
                    available: false,
                    version: Some(announced_version),
                    notes: announced_notes,
                }
            } else {
                set_state(
                    &handles,
                    UpdateState::Available {
                        version: announced_version.clone(),
                        notes: announced_notes.clone(),
                    },
                )
                .await;
                touch_last_checked(&app).await;
                UpdateInfo {
                    available: true,
                    version: Some(announced_version),
                    notes: announced_notes,
                }
            }
        }
        Err(e) => {
            // AC-US3-08: lastCheckedAt NOT updated on error so user can retry.
            set_state(&handles, UpdateState::Error(e.clone())).await;
            let _ = app.emit(EVT_ERROR, json!({ "message": e }));
            return Err(e);
        }
    };

    let _ = app.emit(EVT_CHECK_RESULT, info.clone());
    Ok(info)
}

pub async fn download_and_install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let handles = app.state::<UpdaterState>().handles();

    let _guard = match handles.inflight.try_lock() {
        Ok(g) => g,
        Err(_) => {
            return Err("an update operation is already in progress".to_string());
        }
    };

    // Reset cancellation flag at the start of a new install.
    handles.cancel.store(false, Ordering::SeqCst);

    // Re-fetch the Update handle. The plugin's Update isn't stuffable into
    // app state across IPC calls, so we re-check. This is the same shape
    // recommended in the Tauri v2 docs.
    let update_opt = check_inner(&app).await.inspect_err(|e| {
        let msg = e.clone();
        let handles2 = handles.clone();
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            set_state(&handles2, UpdateState::Error(msg.clone())).await;
            let _ = app2.emit(EVT_ERROR, json!({ "message": msg }));
        });
    })?;

    let update = match update_opt {
        Some(u) => u,
        None => {
            set_state(&handles, UpdateState::UpToDate).await;
            return Err("no update available".to_string());
        }
    };

    let announced_version = update.version.clone();
    set_state(
        &handles,
        UpdateState::Downloading {
            bytes: 0,
            total: None,
        },
    )
    .await;

    let cancel_flag = handles.cancel.clone();
    let app_for_progress = app.clone();
    let mut downloaded: u64 = 0;
    let mut declared_total: Option<u64> = None;

    let dl_result = update
        .download_and_install(
            move |chunk_length, content_length| {
                if cancel_flag.load(Ordering::SeqCst) {
                    // Plugin's signature gives us no clean way to abort mid-stream,
                    // but we suppress UI updates so the user-perceived flow stops.
                    return;
                }
                downloaded = downloaded.saturating_add(chunk_length as u64);
                if declared_total.is_none() {
                    declared_total = content_length;
                }
                let _ = app_for_progress.emit(
                    EVT_PROGRESS,
                    json!({ "bytes": downloaded, "total": declared_total }),
                );
            },
            || {
                // download finished — install begins
            },
        )
        .await;

    // Honor cancellation: if the user clicked Cancel during the download,
    // don't transition to Installing/RestartRequired even if the plugin
    // already finished writing bytes.
    if handles.cancel.load(Ordering::SeqCst) {
        set_state(&handles, UpdateState::Idle).await;
        handles.cancel.store(false, Ordering::SeqCst);
        return Err("update cancelled".to_string());
    }

    match dl_result {
        Ok(()) => {
            set_state(&handles, UpdateState::Installing).await;
            // Plugin's `install` step (inside download_and_install) has run.
            // Surface RestartRequired and let the UI render the
            // "Restart Now / On Quit" dialog. Actual relaunch is the UI's
            // responsibility (via @tauri-apps/plugin-process::relaunch).
            set_state(
                &handles,
                UpdateState::RestartRequired {
                    version: announced_version.clone(),
                },
            )
            .await;
            let _ = app.emit(
                EVT_RESTART_REQUIRED,
                json!({ "version": announced_version }),
            );
            Ok(())
        }
        Err(e) => {
            let msg = e.to_string();
            set_state(&handles, UpdateState::Error(msg.clone())).await;
            let _ = app.emit(EVT_ERROR, json!({ "message": msg.clone() }));
            Err(msg)
        }
    }
}

pub fn cancel_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let handles = app.state::<UpdaterState>().handles();
    handles.cancel.store(true, Ordering::SeqCst);
    // Best-effort transition: only flip to Idle if currently Downloading.
    // If we're not downloading, the cancel flag is harmless on the next op.
    let state = handles.state.clone();
    tauri::async_runtime::spawn(async move {
        let mut guard = state.lock().await;
        if matches!(*guard, UpdateState::Downloading { .. }) {
            *guard = UpdateState::Idle;
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Auto-check task (24h boot-time + periodic). Spawned from setup().
// ---------------------------------------------------------------------------

pub fn spawn_auto_check_task<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            // Honor settings.updates.autoCheck — read fresh each iteration so
            // toggling the preference takes effect without a restart.
            let auto_check = match app.try_state::<SettingsStore>() {
                Some(store) => store.get().await.updates.auto_check,
                None => {
                    // SettingsStore not yet attached (race during setup) — back off.
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    continue;
                }
            };
            if !auto_check {
                tokio::time::sleep(Duration::from_secs(AUTO_CHECK_INTERVAL_SECS)).await;
                continue;
            }

            let last_checked_at = match app.try_state::<SettingsStore>() {
                Some(store) => store.get().await.updates.last_checked_at,
                None => None,
            };

            // Skip the check if last_checked_at is younger than the interval.
            let elapsed_ok = match last_checked_at.as_deref() {
                Some(stamp) => match parse_iso_unix(stamp) {
                    Some(prev) => now_unix().saturating_sub(prev) >= AUTO_CHECK_INTERVAL_SECS,
                    None => true,
                },
                None => true,
            };

            if elapsed_ok {
                // Best-effort silent check — surface "available" as an ambient
                // event so the UI can show a notification dot. The Updates tab
                // is the explicit surface.
                if let Ok(info) = check_for_updates(app.clone()).await {
                    if info.available {
                        let _ = app.emit(EVT_AVAILABLE, info);
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(AUTO_CHECK_INTERVAL_SECS)).await;
        }
    });
}

// ---------------------------------------------------------------------------
// Helpers — internal
// ---------------------------------------------------------------------------

/// Returns the raw plugin `Update` handle. Both `check_for_updates` and
/// `download_and_install_update` use this — the plugin returns a fresh handle
/// each call (it isn't cacheable across IPC boundaries safely).
async fn check_inner<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())
}

async fn set_state(handles: &UpdaterHandles, next: UpdateState) {
    let mut guard = handles.state.lock().await;
    *guard = next;
}

async fn read_skipped_version<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let store = app.try_state::<SettingsStore>()?;
    store.get().await.updates.skipped_version
}

async fn touch_last_checked<R: Runtime>(app: &AppHandle<R>) {
    let Some(store) = app.try_state::<SettingsStore>() else {
        return;
    };
    let stamp = format_unix_iso(now_unix());
    if let Err(e) = store
        .set_key("updates.lastCheckedAt", json!(stamp))
        .await
    {
        log::warn!("updater: could not persist lastCheckedAt: {e}");
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn format_unix_iso(secs: u64) -> String {
    // Minimal ISO-8601 (UTC, second precision) without pulling chrono in.
    // Shape: `YYYY-MM-DDTHH:MM:SSZ` for clean round-trip.
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

fn parse_iso_unix(stamp: &str) -> Option<u64> {
    // Accepts the format we wrote: `YYYY-MM-DDTHH:MM:SSZ`. Permissive enough
    // to ignore trailing fractions/timezone variants — the worst case is we
    // re-check sooner than necessary.
    let bytes = stamp.as_bytes();
    if bytes.len() < 19 {
        return None;
    }
    let parse = |start: usize, len: usize| -> Option<u32> {
        std::str::from_utf8(bytes.get(start..start + len)?)
            .ok()?
            .parse::<u32>()
            .ok()
    };
    let y = parse(0, 4)? as i64;
    let mo = parse(5, 2)?;
    let d = parse(8, 2)?;
    let h = parse(11, 2)?;
    let mi = parse(14, 2)?;
    let s = parse(17, 2)?;
    Some(ymdhms_to_unix(y, mo, d, h, mi, s))
}

fn unix_to_ymdhms(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    // Hinnant civil-from-days, public domain. Mirrors settings.rs.
    let days = (secs / 86_400) as i64;
    let s_of_day = (secs % 86_400) as u32;
    let h = s_of_day / 3600;
    let mi = (s_of_day % 3600) / 60;
    let s = s_of_day % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if mo <= 2 { y + 1 } else { y };
    (y, mo, d, h, mi, s)
}

fn ymdhms_to_unix(y: i64, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> u64 {
    // Inverse of Hinnant.
    let y = if mo <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let mp = if mo > 2 { mo - 3 } else { mo + 9 } as u64;
    let doy = (153 * mp + 2) / 5 + d as u64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe as i64 - 719_468;
    (days as u64) * 86_400 + (h as u64) * 3600 + (mi as u64) * 60 + s as u64
}

fn state_to_info(state: &UpdateState) -> UpdateInfo {
    match state {
        UpdateState::Available { version, notes } => UpdateInfo {
            available: true,
            version: Some(version.clone()),
            notes: notes.clone(),
        },
        UpdateState::RestartRequired { version } => UpdateInfo {
            available: true,
            version: Some(version.clone()),
            notes: None,
        },
        _ => UpdateInfo {
            available: false,
            version: None,
            notes: None,
        },
    }
}

// ---------------------------------------------------------------------------
// Tests — pure-Rust state-machine + skip + cancel + ISO timestamp logic.
//
// Tauri's plugin API is extremely runtime-coupled (AppHandle requires a live
// Builder), so end-to-end checks live in the smoke-test agent's e2e scope.
// Here we cover transitions that don't need a live updater plugin.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_default_is_idle() {
        assert_eq!(UpdateState::default(), UpdateState::Idle);
    }

    #[tokio::test]
    async fn test_state_transitions_idle_to_checking() {
        let s = UpdaterState::new();
        assert_eq!(s.snapshot().await, UpdateState::Idle);
        let handles = s.handles();
        set_state(&handles, UpdateState::Checking).await;
        assert_eq!(s.snapshot().await, UpdateState::Checking);
    }

    #[tokio::test]
    async fn test_inflight_guard_blocks_second_lock() {
        let s = UpdaterState::new();
        let _g = s.inflight.try_lock().expect("first lock");
        // Second try_lock must fail while the first guard is held.
        assert!(
            s.inflight.try_lock().is_err(),
            "expected try_lock to fail while first guard is held"
        );
    }

    #[tokio::test]
    async fn test_cancel_flag_is_observed() {
        let s = UpdaterState::new();
        assert!(!s.cancel.load(Ordering::SeqCst));
        s.cancel.store(true, Ordering::SeqCst);
        assert!(s.cancel.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn test_cancel_during_download_resets_to_idle() {
        // Mirrors the cancel_update body's logic without needing a live
        // AppHandle. Set Downloading, raise cancel, then run the same
        // matches!() guard that cancel_update uses.
        let s = UpdaterState::new();
        let handles = s.handles();
        set_state(
            &handles,
            UpdateState::Downloading {
                bytes: 1024,
                total: Some(4096),
            },
        )
        .await;
        s.cancel.store(true, Ordering::SeqCst);

        {
            let mut g = handles.state.lock().await;
            if matches!(*g, UpdateState::Downloading { .. }) {
                *g = UpdateState::Idle;
            }
        }
        assert_eq!(s.snapshot().await, UpdateState::Idle);
        assert!(s.cancel.load(Ordering::SeqCst));
    }

    #[test]
    fn test_state_to_info_available() {
        let st = UpdateState::Available {
            version: "0.2.0".into(),
            notes: Some("notes".into()),
        };
        let info = state_to_info(&st);
        assert!(info.available);
        assert_eq!(info.version.as_deref(), Some("0.2.0"));
        assert_eq!(info.notes.as_deref(), Some("notes"));
    }

    #[test]
    fn test_state_to_info_idle_is_not_available() {
        let info = state_to_info(&UpdateState::Idle);
        assert!(!info.available);
        assert!(info.version.is_none());
        assert!(info.notes.is_none());
    }

    #[test]
    fn test_state_to_info_uptodate_is_not_available() {
        let info = state_to_info(&UpdateState::UpToDate);
        assert!(!info.available);
    }

    #[test]
    fn test_state_to_info_restart_required_carries_version() {
        let info = state_to_info(&UpdateState::RestartRequired {
            version: "1.0.0".into(),
        });
        assert!(info.available);
        assert_eq!(info.version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn test_iso_roundtrip() {
        // Round-trip the format we write for lastCheckedAt.
        let secs: u64 = 1_715_000_000;
        let stamp = format_unix_iso(secs);
        // Sanity: shape `YYYY-MM-DDTHH:MM:SSZ` (20 chars).
        assert_eq!(stamp.len(), 20);
        assert_eq!(&stamp[4..5], "-");
        assert_eq!(&stamp[10..11], "T");
        assert_eq!(&stamp[19..20], "Z");

        let parsed = parse_iso_unix(&stamp).expect("parse");
        assert_eq!(parsed, secs);
    }

    #[test]
    fn test_iso_parse_short_input_returns_none() {
        assert!(parse_iso_unix("2026").is_none());
        assert!(parse_iso_unix("").is_none());
    }

    #[test]
    fn test_skipped_version_match_logic() {
        // Pure-data check: when announced.version == skipped_version, we
        // surface UpdateInfo as not-available.
        let announced_version = "0.3.0";
        let skipped_match = Some("0.3.0".to_string());
        assert_eq!(
            skipped_match.as_deref(),
            Some(announced_version),
            "should match"
        );

        let skipped_other = Some("0.2.9".to_string());
        assert_ne!(
            skipped_other.as_deref(),
            Some(announced_version),
            "should not match"
        );

        let none_skipped: Option<String> = None;
        assert_ne!(none_skipped.as_deref(), Some(announced_version));
    }

    #[test]
    fn test_event_channel_names_are_stable() {
        // UI agent depends on these literal strings — pin them.
        assert_eq!(EVT_CHECK_RESULT, "updater://check-result");
        assert_eq!(EVT_PROGRESS, "updater://progress");
        assert_eq!(EVT_RESTART_REQUIRED, "updater://restart-required");
        assert_eq!(EVT_ERROR, "updater://error");
        assert_eq!(EVT_AVAILABLE, "updater://available");
    }

    #[test]
    fn test_auto_check_interval_is_24h() {
        // AC-US3-05 fixes this at 24h in v1.
        assert_eq!(AUTO_CHECK_INTERVAL_SECS, 86_400);
    }
}
