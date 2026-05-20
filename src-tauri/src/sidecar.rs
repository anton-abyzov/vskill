// Sidecar lifecycle: spawn the bundled Node server, capture LISTEN_PORT,
// poll /api/health, manage graceful shutdown and 3-strikes-in-60s crash recovery.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::mpsc;
use tokio::time::sleep;

const SIDECAR_NAME: &str = "vskill-server";
const HEALTH_POLL_INTERVAL_MS: u64 = 200;
const HEALTH_TIMEOUT_MS: u64 = 10_000;
const SHUTDOWN_GRACE_MS: u64 = 2_000;
const STRIKE_WINDOW_MS: u128 = 60_000;
const MAX_STRIKES: u32 = 3;
const NO_PID: u32 = 0;

static ACTIVE_SIDECAR_PID: AtomicU32 = AtomicU32::new(NO_PID);

#[derive(Debug, Default, Serialize, Clone)]
pub struct SidecarStatus {
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub running: bool,
}

#[derive(Default)]
pub struct SidecarState {
    pub child: Option<CommandChild>,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub strike_count: u32,
    pub first_strike_at: Option<Instant>,
    pub last_strike_at: Option<Instant>,
    /// PID currently expected to terminate because we initiated shutdown.
    /// Used to suppress crash auto-restart when the user quits/restarts.
    pub terminating_pid: Option<u32>,
    /// 0832: when set, the next `spawn_sidecar` call short-circuits with
    /// `Ok(port)` so the boot path can navigate to the external instance
    /// instead of spawning a new sidecar. Cleared after one consumption.
    pub skip_spawn_to_port: Option<u16>,
    /// 0832 (run-alongside fix): when true, the next `spawn_sidecar` call
    /// skips the lifecycle scan/modal gate entirely and proceeds straight
    /// to the spawn path. Cleared after one consumption. Used by
    /// `lifecycle_run_alongside` so the user's explicit choice isn't
    /// overridden by the gate re-firing on the same external instance.
    pub bypass_scan_once: bool,
    /// 0836 US-002: per-process X-Studio-Token captured from the sidecar's
    /// `Studio token: <token>` stdout banner. Forwarded to the WebView via
    /// the `get_studio_token` Tauri IPC, never logged, never persisted.
    /// Reset on every spawn so a stale token from a crashed prior sidecar
    /// can't bleed into the next process.
    pub studio_token: Option<String>,
}

pub type SharedSidecar = Arc<Mutex<SidecarState>>;

fn track_sidecar_pid(pid: Option<u32>) {
    ACTIVE_SIDECAR_PID.store(pid.unwrap_or(NO_PID), Ordering::SeqCst);
}

fn tracked_sidecar_pid() -> Option<u32> {
    match ACTIVE_SIDECAR_PID.load(Ordering::SeqCst) {
        NO_PID => None,
        pid => Some(pid),
    }
}

fn clear_tracked_sidecar_pid_if(pid: u32) {
    let _ = ACTIVE_SIDECAR_PID.compare_exchange(pid, NO_PID, Ordering::SeqCst, Ordering::SeqCst);
}

/// Activity Monitor "Quit" sends SIGTERM to the app process and can bypass
/// Tauri's RunEvent shutdown path. Keep this handler async-signal-safe:
/// signal the sidecar PID from an atomic, then exit this process.
#[cfg(unix)]
pub fn install_termination_signal_handler() {
    unsafe {
        libc::signal(
            libc::SIGTERM,
            handle_termination_signal as *const () as libc::sighandler_t,
        );
    }
}

#[cfg(not(unix))]
pub fn install_termination_signal_handler() {}

#[cfg(unix)]
extern "C" fn handle_termination_signal(_signal: libc::c_int) {
    let pid = ACTIVE_SIDECAR_PID.load(Ordering::SeqCst);
    if pid != NO_PID {
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }
    unsafe {
        libc::_exit(128 + libc::SIGTERM);
    }
}

/// Spawn the sidecar binary, wait for `LISTEN_PORT=<port>` on stdout, then
/// poll `/api/health` until 200 OK. Returns the listening port on success.
///
/// Boxed because the supervisor in `handle_unexpected_exit` re-enters this
/// function on auto-restart, which the compiler otherwise refuses to type
/// without an explicit indirection.
pub fn spawn_sidecar<'a>(
    app: &'a AppHandle,
    state: SharedSidecar,
) -> Pin<Box<dyn Future<Output = Result<u16, String>> + Send + 'a>> {
    Box::pin(async move {
        // 0832 T-008: pre-flight scan. If an external (non-Tauri) studio
        // instance is already running, emit the lifecycle event and pause
        // sidecar spawn. The lifecycle handlers will either:
        //   (a) navigate to the existing port + skip spawn forever (use-existing),
        //   (b) kill it + retry spawn_sidecar (stop-and-replace), or
        //   (c) close the modal + let spawn proceed (run-alongside).
        //
        // If the user picked "use existing" earlier in the session, we honour
        // skip_spawn_to_port and return early with that port.
        {
            let skip_port = {
                let mut s = state.lock().unwrap();
                s.skip_spawn_to_port.take()
            };
            if let Some(port) = skip_port {
                log::info!("sidecar spawn skipped — using external studio instance on port {port}");
                // 0832 F-001: clear `pid` on the use-existing early return so
                // the Studio Instances submenu doesn't flag a stale or empty
                // Tauri PID as the active app. The "this app" marker is
                // applied via the `Tauri` source classification regardless.
                let mut s = state.lock().unwrap();
                s.port = Some(port);
                s.pid = None;
                track_sidecar_pid(None);
                return Ok(port);
            }
        }

        // 0832 F-002: one-shot bypass for run-alongside. lifecycle_run_alongside
        // sets this so the gate doesn't re-fire on the same external instance.
        let bypass_scan = {
            let mut s = state.lock().unwrap();
            let v = s.bypass_scan_once;
            s.bypass_scan_once = false;
            v
        };

        // Scan for external instances. The 500ms hard timeout is in `scan()`
        // itself, so this never blocks cold-launch. We only act when there is
        // exactly one external (source != Tauri) hit — a single match is the
        // unambiguous case the lifecycle modal handles. Multiple matches fall
        // through to the Window > Studio Instances submenu (T-012).
        let detected: Vec<crate::process_discovery::ProcessRecord> = if bypass_scan {
            log::info!("sidecar spawn: bypass_scan_once active, skipping lifecycle gate");
            Vec::new()
        } else {
            crate::process_discovery::scan().await.unwrap_or_default()
        };
        reap_orphaned_tauri_sidecars(&detected).await;
        let external = reachable_lifecycle_candidates(&detected).await;
        // 0832 F-004: AC-US1-03 says "exactly one external instance found" — the
        // modal handles only the unambiguous case. Multi-external falls through
        // to normal spawn; the user can manage them via Window > Studio Instances.
        if external.len() == 1 {
            let first = &external[0];
            log::info!(
                "sidecar spawn paused — external instance detected at port {} pid {}",
                first.port,
                first.pid
            );

            // 0832 T-011: honor `studio.lifecycleDefault` if the user has
            // already picked a default action. "ask" (the default value)
            // opens the modal; the others auto-execute the saved choice.
            let lifecycle_default = read_lifecycle_default(app).await;
            match lifecycle_default.as_deref() {
                Some("use-existing") => {
                    log::info!(
                        "lifecycleDefault=use-existing — using port {} without modal",
                        first.port
                    );
                    {
                        let mut s = state.lock().unwrap();
                        s.port = Some(first.port);
                    }
                    let _ = load_studio_url(app, first.port);
                    return Ok(first.port);
                }
                Some("run-alongside") => {
                    log::info!("lifecycleDefault=run-alongside — proceeding with normal spawn");
                    // Fall through to spawn — DO NOT open modal.
                }
                Some("stop-and-replace") => {
                    log::info!(
                        "lifecycleDefault=stop-and-replace — SIGTERM pid {}",
                        first.pid
                    );
                    sigterm_with_grace(first.pid, Duration::from_millis(3000)).await;
                    // Fall through to spawn.
                }
                _ => {
                    // "ask" or unset → open the modal and pause.
                    crate::lifecycle_modal::set_detected(first.clone());
                    let _ = crate::lifecycle_modal::open(app, first);
                    return Err("lifecycle-modal-pending".to_string());
                }
            }
        }

        log::info!("spawning sidecar `{}` --port 0", SIDECAR_NAME);

        let cmd = app
            .shell()
            .sidecar(SIDECAR_NAME)
            .map_err(|e| format!("sidecar lookup failed: {e}"))?
            .args(["--port", "0"]);

        let (mut rx, child) = cmd
            .spawn()
            .map_err(|e| format!("sidecar spawn failed: {e}"))?;

        let pid = child.pid();
        {
            let mut s = state.lock().unwrap();
            s.child = Some(child);
            s.pid = Some(pid);
            s.port = None;
            track_sidecar_pid(Some(pid));
            // 0836 US-002: reset studio token on a fresh spawn — the new
            // sidecar will emit a fresh `Studio token: <token>` banner on
            // stdout and we want the IPC to return None until that arrives.
            s.studio_token = None;
        }

        // Channel — port detector pushes the port the moment we see LISTEN_PORT=...
        let (port_tx, mut port_rx) = mpsc::channel::<u16>(1);

        let app_clone = app.clone();
        let state_clone = state.clone();
        let spawned_pid = pid;
        tokio::spawn(async move {
            let mut port_announced = false;
            let mut token_captured = false;
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let text = String::from_utf8_lossy(&line).to_string();
                        if !port_announced {
                            if let Some(port) = parse_listen_port(&text) {
                                port_announced = true;
                                let _ = port_tx.send(port).await;
                            }
                        }
                        // 0836 US-002: capture the `Studio token: <token>`
                        // banner once. Suppress the line from debug logs so
                        // the value never lands in user-shared log captures.
                        if !token_captured {
                            if let Some(token) = parse_studio_token(&text) {
                                token_captured = true;
                                let mut s = state_clone.lock().unwrap();
                                s.studio_token = Some(token);
                                log::debug!("[sidecar] studio token captured");
                                continue;
                            }
                        }
                        log::debug!("[sidecar stdout] {}", text.trim_end());
                    }
                    CommandEvent::Stderr(line) => {
                        let text = String::from_utf8_lossy(&line).to_string();
                        log::warn!("[sidecar stderr] {}", text.trim_end());
                    }
                    CommandEvent::Error(err) => {
                        log::error!("[sidecar error] {err}");
                    }
                    CommandEvent::Terminated(payload) => {
                        log::warn!(
                            "[sidecar terminated] code={:?} signal={:?}",
                            payload.code,
                            payload.signal
                        );
                        if mark_child_terminated(&state_clone, spawned_pid) {
                            log::info!(
                                "sidecar pid {spawned_pid} terminated during expected shutdown"
                            );
                            break;
                        }
                        handle_unexpected_exit(app_clone.clone(), state_clone.clone());
                        break;
                    }
                    _ => {}
                }
            }
        });

        let port =
            match tokio::time::timeout(Duration::from_millis(HEALTH_TIMEOUT_MS), port_rx.recv())
                .await
            {
                Ok(Some(p)) => p,
                Ok(None) => return Err("sidecar exited before announcing port".into()),
                Err(_) => return Err("timed out waiting for LISTEN_PORT from sidecar".into()),
            };

        {
            let mut s = state.lock().unwrap();
            s.port = Some(port);
        }

        poll_health(port).await?;
        log::info!("sidecar healthy on port {port}");

        Ok(port)
    })
}

fn parse_listen_port(line: &str) -> Option<u16> {
    line.split_whitespace().find_map(|tok| {
        tok.strip_prefix("LISTEN_PORT=")
            .and_then(|n| n.trim().parse::<u16>().ok())
    })
}

/// 0836 US-002: pull the per-process studio token out of the eval-server's
/// `Studio token: <token>` startup banner. The banner is base64url-encoded
/// (43 chars, `[A-Za-z0-9_-]`) — we accept any non-whitespace token after
/// the marker so a future encoding bump doesn't break this parser. Returns
/// `None` for any line that doesn't carry the marker.
fn parse_studio_token(line: &str) -> Option<String> {
    // Match the marker substring rather than splitting on whitespace because
    // a leading indent ("  Studio token: ABC") is the actual emitted shape.
    let needle = "Studio token:";
    let idx = line.find(needle)?;
    let rest = line[idx + needle.len()..].trim_start();
    let tok = rest.split(|c: char| c.is_whitespace()).next()?.trim();
    if tok.is_empty() {
        return None;
    }
    Some(tok.to_string())
}

async fn poll_health(port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/health");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1_000))
        .build()
        .map_err(|e| format!("http client build failed: {e}"))?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(HEALTH_TIMEOUT_MS) {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        sleep(Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;
    }
    Err(format!(
        "sidecar health check timed out after {} ms ({})",
        HEALTH_TIMEOUT_MS, url
    ))
}

async fn reachable_lifecycle_candidates(
    records: &[crate::process_discovery::ProcessRecord],
) -> Vec<crate::process_discovery::ProcessRecord> {
    let mut out = Vec::new();
    for record in records {
        if !is_lifecycle_candidate(record) {
            continue;
        }
        if existing_studio_health_ok(record.port).await {
            out.push(record.clone());
        } else {
            log::warn!(
                "ignoring stale studio candidate at port {} pid {} — /api/health did not respond",
                record.port,
                record.pid
            );
        }
    }
    out
}

fn is_lifecycle_candidate(record: &crate::process_discovery::ProcessRecord) -> bool {
    record.source != crate::process_discovery::ProcessSource::Tauri && record.port != 0
}

async fn existing_studio_health_ok(port: u16) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_millis(700))
        .build()
    else {
        return false;
    };
    let url = format!("http://127.0.0.1:{port}/api/health");
    client
        .get(url)
        .send()
        .await
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

/// Graceful shutdown: POST /api/shutdown (2s budget) → SIGTERM → wait 1s → SIGKILL.
///
/// `child.kill()` from `tauri-plugin-shell` sends SIGKILL on Unix, but only on
/// the exact spawned PID. On macOS Cmd+Q the runtime tears down before the kill
/// is acknowledged, so we additionally raise SIGTERM/SIGKILL via libc against the
/// stored PID — that gives the OS a synchronous handle that survives the runtime
/// drop.
pub async fn graceful_shutdown(state: SharedSidecar) {
    let (port, child_taken, pid) = {
        let mut s = state.lock().unwrap();
        if let Some(pid) = s.pid {
            s.terminating_pid = Some(pid);
        }
        (s.port, s.child.take(), s.pid)
    };

    // Step 1: ask the sidecar to shut itself down via /api/shutdown.
    if let Some(port) = port {
        let url = format!("http://127.0.0.1:{port}/api/shutdown");
        if let Ok(client) = reqwest::Client::builder()
            .timeout(Duration::from_millis(SHUTDOWN_GRACE_MS))
            .build()
        {
            let _ = client.post(&url).send().await;
        }
    }

    // Step 2: if the child is still alive, SIGTERM it and wait up to 1s.
    if let Some(pid) = pid {
        if pid_is_alive(pid) {
            send_signal(pid, Signal::Term);
            let waited = wait_for_exit(pid, Duration::from_millis(1_000)).await;
            // Step 3: still alive after grace? SIGKILL.
            if !waited {
                log::warn!("sidecar pid {pid} did not exit after SIGTERM, sending SIGKILL");
                send_signal(pid, Signal::Kill);
                let _ = wait_for_exit(pid, Duration::from_millis(500)).await;
            }
        }
    }

    // Step 4: belt-and-suspenders — call Tauri's child.kill() too. Cheap if the
    // process is already gone; on Windows this is the primary kill path.
    if let Some(child) = child_taken {
        let killer = tokio::task::spawn_blocking(move || {
            let _ = child.kill();
        });
        let _ = tokio::time::timeout(Duration::from_millis(500), killer).await;
    }

    let mut s = state.lock().unwrap();
    s.port = None;
    s.pid = None;
    track_sidecar_pid(None);
}

/// Synchronous last-resort kill — invoked from RunEvent::Exit, which fires after
/// the runtime is winding down and async work cannot complete reliably.
pub fn force_kill_pid(state: &SharedSidecar) {
    let pid = {
        let s = state.lock().unwrap();
        s.pid
    }
    .or_else(tracked_sidecar_pid);
    if let Some(pid) = pid {
        if pid_is_alive(pid) {
            log::warn!("RunEvent::Exit catch-all: SIGKILL on sidecar pid {pid}");
            send_signal(pid, Signal::Kill);
        }
        clear_tracked_sidecar_pid_if(pid);
    }
}

fn mark_child_terminated(state: &SharedSidecar, pid: u32) -> bool {
    let mut s = state.lock().unwrap();
    let expected = s.terminating_pid == Some(pid);
    if expected {
        s.terminating_pid = None;
    }
    if s.pid == Some(pid) {
        s.child = None;
        s.pid = None;
        s.port = None;
        s.studio_token = None;
    }
    clear_tracked_sidecar_pid_if(pid);
    expected
}

async fn reap_orphaned_tauri_sidecars(records: &[crate::process_discovery::ProcessRecord]) {
    for record in records {
        if record.source == crate::process_discovery::ProcessSource::Tauri
            && is_orphaned_process(record.pid)
        {
            log::warn!(
                "found orphaned Tauri sidecar pid {} on boot; terminating before spawning a new one",
                record.pid
            );
            sigterm_with_grace(record.pid, Duration::from_millis(1_000)).await;
        }
    }
}

fn is_orphaned_process(pid: u32) -> bool {
    matches!(parent_pid(pid), Some(1))
}

#[cfg(unix)]
fn parent_pid(pid: u32) -> Option<u32> {
    let output = std::process::Command::new("ps")
        .args(["-o", "ppid=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse().ok()
}

#[cfg(not(unix))]
fn parent_pid(_pid: u32) -> Option<u32> {
    None
}

#[derive(Copy, Clone)]
enum Signal {
    Term,
    Kill,
}

#[cfg(unix)]
fn send_signal(pid: u32, sig: Signal) {
    let signum = match sig {
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
    };
    unsafe {
        libc::kill(pid as libc::pid_t, signum);
    }
}

#[cfg(not(unix))]
fn send_signal(_pid: u32, _sig: Signal) {
    // Non-Unix: the Tauri child.kill() path is the only mechanism.
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    // kill(pid, 0) returns 0 if the process exists and we can signal it,
    // -1 with errno=ESRCH if it does not exist.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    true
}

async fn wait_for_exit(pid: u32, max: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < max {
        if !pid_is_alive(pid) {
            return true;
        }
        sleep(Duration::from_millis(50)).await;
    }
    !pid_is_alive(pid)
}

/// 0832 helper: read `studio.lifecycleDefault` from the SettingsStore. Returns
/// None if the store isn't available yet (very early boot path). Falls back
/// to "ask" semantics when None.
async fn read_lifecycle_default(app: &AppHandle) -> Option<String> {
    let store = app.try_state::<crate::preferences::SettingsStore>()?;
    let snapshot = store.get().await;
    Some(snapshot.studio.lifecycle_default)
}

/// 0832 helper: SIGTERM `pid`, wait `grace`, escalate to SIGKILL if alive.
///
/// Cross-platform: Unix uses libc signals; Windows shells out to `taskkill`
/// which doesn't have a separate "graceful" stage, so the grace window is
/// honored by waiting before the forced kill. `pub(crate)` so the lifecycle
/// IPC handlers in commands.rs can reuse this rather than duplicating the
/// logic.
pub(crate) async fn sigterm_with_grace(pid: u32, grace: Duration) {
    #[cfg(unix)]
    {
        if !pid_is_alive(pid) {
            return;
        }
        send_signal(pid, Signal::Term);
        let exited = wait_for_exit(pid, grace).await;
        if !exited && pid_is_alive(pid) {
            log::warn!("sigterm_with_grace: pid {pid} did not exit, sending SIGKILL");
            send_signal(pid, Signal::Kill);
            let _ = wait_for_exit(pid, Duration::from_millis(500)).await;
        }
    }
    #[cfg(not(unix))]
    {
        // Windows: taskkill /T /F is the equivalent of SIGKILL. There's no
        // SIGTERM analogue without a custom WM_CLOSE message handler in the
        // target, so we honor `grace` by waiting before the forced kill.
        let _ = grace; // grace is not used on Windows; suppress unused warning
        let _ = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .await;
    }
}

/// Crash supervisor: counts strikes within a 60 s sliding window. ≤3 triggers
/// a silent restart with a "server-restarted" event; the 4th surfaces a native
/// dialog so the user can choose Restart / View Logs / Quit.
fn handle_unexpected_exit(app: AppHandle, state: SharedSidecar) {
    let now = Instant::now();
    let (should_restart, strike_count_after) = {
        let mut s = state.lock().unwrap();

        if let Some(last) = s.last_strike_at {
            if now.duration_since(last).as_millis() > STRIKE_WINDOW_MS {
                s.strike_count = 0;
                s.first_strike_at = None;
            }
        }

        s.strike_count += 1;
        s.last_strike_at = Some(now);
        if s.first_strike_at.is_none() {
            s.first_strike_at = Some(now);
        }

        let in_window = s
            .first_strike_at
            .map(|t| now.duration_since(t).as_millis() <= STRIKE_WINDOW_MS)
            .unwrap_or(false);

        let should_restart = s.strike_count <= MAX_STRIKES && in_window;
        (should_restart, s.strike_count)
    };

    log::warn!(
        "sidecar exited unexpectedly (strike {}/{})",
        strike_count_after,
        MAX_STRIKES
    );

    if should_restart {
        tokio::spawn(async move {
            sleep(Duration::from_millis(500)).await;
            match spawn_sidecar(&app, state.clone()).await {
                Ok(port) => {
                    let _ = app.emit("server-restarted", port);
                }
                Err(e) => {
                    log::error!("auto-restart failed: {e}");
                    let _ = app.emit("server-crashed", e);
                }
            }
        });
    } else {
        let _ = app.emit(
            "server-crashed",
            "sidecar exited 4+ times in 60 seconds".to_string(),
        );
    }
}

/// Reset strike state — invoked from the manual "Restart Server" command.
pub fn reset_strikes(state: &SharedSidecar) {
    let mut s = state.lock().unwrap();
    s.strike_count = 0;
    s.first_strike_at = None;
    s.last_strike_at = None;
}

pub fn snapshot(state: &SharedSidecar) -> SidecarStatus {
    let s = state.lock().unwrap();
    SidecarStatus {
        port: s.port,
        pid: s.pid,
        running: s.child.is_some(),
    }
}

/// Convenience: read the active main window if it exists and load the studio.
pub fn load_studio_url(app: &AppHandle, port: u16) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/")
        .parse::<tauri::Url>()
        .map_err(|e| format!("invalid studio URL: {e}"))?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .navigate(url)
            .map_err(|e| format!("navigate failed: {e}"))?;
        let _ = window.show();
        let _ = window.set_focus();
        Ok(())
    } else {
        Err("main window not found".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clear_tracked_sidecar_pid_if, is_lifecycle_candidate, mark_child_terminated,
        parse_listen_port, parse_studio_token, track_sidecar_pid, tracked_sidecar_pid,
        SharedSidecar, SidecarState,
    };
    use crate::process_discovery::{ProcessRecord, ProcessSource};
    use std::sync::{Arc, Mutex};

    static PID_TRACKER_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn parses_basic_listen_port() {
        assert_eq!(parse_listen_port("LISTEN_PORT=3077"), Some(3077));
    }

    #[test]
    fn parses_listen_port_in_noisy_line() {
        assert_eq!(
            parse_listen_port("[boot] ready  LISTEN_PORT=49152  pid=4321"),
            Some(49152)
        );
    }

    #[test]
    fn ignores_lines_without_listen_port() {
        assert_eq!(
            parse_listen_port("Skill Studio: http://localhost:3077"),
            None
        );
    }

    #[test]
    fn rejects_garbage_port_value() {
        assert_eq!(parse_listen_port("LISTEN_PORT=abc"), None);
    }

    // -------------------------------------------------------------------------
    // 0836 US-002 — parse_studio_token covers the eval-server banner shape:
    //   "  Studio token: <43-char base64url>\n"
    // -------------------------------------------------------------------------

    #[test]
    fn parses_studio_token_from_indented_banner() {
        let line = "  Studio token: AbCdEf-_GhIjKlMnOpQrStUvWxYz0123456789ABCDEF\n";
        assert_eq!(
            parse_studio_token(line).as_deref(),
            Some("AbCdEf-_GhIjKlMnOpQrStUvWxYz0123456789ABCDEF")
        );
    }

    #[test]
    fn parses_studio_token_without_indent() {
        assert_eq!(
            parse_studio_token("Studio token: tokA").as_deref(),
            Some("tokA")
        );
    }

    #[test]
    fn ignores_lines_without_studio_token_marker() {
        assert_eq!(
            parse_studio_token("Skill Studio: http://localhost:3077"),
            None
        );
        assert_eq!(parse_studio_token("LISTEN_PORT=3077"), None);
    }

    #[test]
    fn ignores_blank_token_value() {
        assert_eq!(parse_studio_token("Studio token:    "), None);
        assert_eq!(parse_studio_token("Studio token:"), None);
    }

    #[test]
    fn captures_first_whitespace_terminated_token() {
        // Defensive: if a future banner adds trailing fields, we capture only
        // the first whitespace-bounded value.
        assert_eq!(
            parse_studio_token("Studio token: tokenA other-field=x").as_deref(),
            Some("tokenA")
        );
    }

    #[test]
    fn lifecycle_candidates_must_be_external_and_have_a_port() {
        let base = ProcessRecord {
            pid: 4242,
            port: 3077,
            started_at: String::new(),
            source: ProcessSource::NpxCli,
            cmdline: "npx vskill studio".to_string(),
        };
        assert!(is_lifecycle_candidate(&base));
        assert!(!is_lifecycle_candidate(&ProcessRecord {
            source: ProcessSource::Tauri,
            ..base.clone()
        }));
        assert!(!is_lifecycle_candidate(&ProcessRecord {
            port: 0,
            ..base
        }));
    }

    #[test]
    fn tracks_active_sidecar_pid_for_signal_shutdown() {
        let _guard = PID_TRACKER_TEST_LOCK.lock().unwrap();
        track_sidecar_pid(Some(4242));
        assert_eq!(tracked_sidecar_pid(), Some(4242));

        clear_tracked_sidecar_pid_if(1111);
        assert_eq!(tracked_sidecar_pid(), Some(4242));

        clear_tracked_sidecar_pid_if(4242);
        assert_eq!(tracked_sidecar_pid(), None);
    }

    #[test]
    fn expected_child_termination_clears_state_without_restart() {
        let _guard = PID_TRACKER_TEST_LOCK.lock().unwrap();
        let state: SharedSidecar = Arc::new(Mutex::new(SidecarState {
            pid: Some(4243),
            port: Some(3077),
            terminating_pid: Some(4243),
            studio_token: Some("token".to_string()),
            ..SidecarState::default()
        }));
        track_sidecar_pid(Some(4243));

        assert!(mark_child_terminated(&state, 4243));

        let s = state.lock().unwrap();
        assert_eq!(s.pid, None);
        assert_eq!(s.port, None);
        assert_eq!(s.terminating_pid, None);
        assert_eq!(s.studio_token, None);
        assert_eq!(tracked_sidecar_pid(), None);
    }

    #[test]
    fn unexpected_child_termination_clears_state_and_allows_restart() {
        let _guard = PID_TRACKER_TEST_LOCK.lock().unwrap();
        let state: SharedSidecar = Arc::new(Mutex::new(SidecarState {
            pid: Some(4244),
            port: Some(3078),
            ..SidecarState::default()
        }));
        track_sidecar_pid(Some(4244));

        assert!(!mark_child_terminated(&state, 4244));

        let s = state.lock().unwrap();
        assert_eq!(s.pid, None);
        assert_eq!(s.port, None);
        assert_eq!(tracked_sidecar_pid(), None);
    }
}
