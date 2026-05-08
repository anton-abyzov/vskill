// 0832 process_discovery — enumerate running studio instances.
//
// Architecture:
//   1. Lock-file fast path: read every `~/.vskill/runtime/studio-*.lock`,
//      cross-check that the PID is still alive AND that its cmdline still
//      contains a vskill marker (catches PID reuse). Stale entries pruned.
//   2. Platform-native fallback: discover orphan processes that don't have
//      a lock file (older CLIs, manually-spawned `node vskill-server`, etc.).
//      macOS: `pgrep -f` + `lsof -p`. Linux: `/proc` walk. Windows:
//      `Get-NetTCPConnection` via PowerShell.
//
// The scanner is wrapped in `tokio::time::timeout(500ms)` so a stuck
// platform-native call never blocks the cold-launch budget. On timeout we
// log a warning and return an empty Vec — the user is no worse off than if
// the scanner didn't exist.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

const SCAN_TIMEOUT: Duration = Duration::from_millis(500);
const STALE_LOCK_AGE_SECS: i64 = 24 * 60 * 60; // 1 day
const VSKILL_MARKER: &str = "vskill";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProcessSource {
    Tauri,
    NpxCli,
    NodeDirect,
}

impl ProcessSource {
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "tauri" => ProcessSource::Tauri,
            "node-direct" => ProcessSource::NodeDirect,
            _ => ProcessSource::NpxCli,
        }
    }

    pub fn shorthand(&self) -> &'static str {
        match self {
            ProcessSource::Tauri => "this app",
            ProcessSource::NpxCli => "npx",
            ProcessSource::NodeDirect => "node",
        }
    }
}

/// 0832 F-GRILL-01: `#[serde(rename_all = "camelCase")]` ensures `started_at`
/// serializes as `startedAt` to match the React `LifecycleApp` consumer
/// (which reads `detected.startedAt`). Without this rename, the relative-time
/// label in the lifecycle modal silently fell back to "just now" forever
/// because `startedAt` was undefined on the JS side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRecord {
    pub pid: u32,
    pub port: u16,
    pub started_at: String,
    pub source: ProcessSource,
    pub cmdline: String,
}

/// Top-level scan with a hard 500ms timeout. Never blocks cold-launch.
///
/// Always returns Ok(Vec) — internal failures degrade gracefully to an empty
/// result so the desktop app can boot without a usable scan.
pub async fn scan() -> Result<Vec<ProcessRecord>, String> {
    match tokio::time::timeout(SCAN_TIMEOUT, scan_inner()).await {
        Ok(records) => Ok(records),
        Err(_) => {
            log::warn!(
                "process_discovery::scan() exceeded {}ms budget — returning empty",
                SCAN_TIMEOUT.as_millis()
            );
            Ok(Vec::new())
        }
    }
}

async fn scan_inner() -> Vec<ProcessRecord> {
    let mut records = scan_lock_files();

    // 0832 F-LOGIC-01 (review pass 2): scan_lock_files itself does NOT dedupe
    // by PID. If two lock files coincidentally point to the same PID (manual
    // file edits or a buggy CLI), both rows would slip through. Dedupe here
    // before merging platform results — keep the first occurrence (lock files
    // are read in directory order; deterministic enough for UI).
    {
        let mut seen_pids = std::collections::HashSet::new();
        records.retain(|r| seen_pids.insert(r.pid));
    }

    // Platform fallback: discover lock-less instances. We dedupe by PID at
    // the end so a process that has BOTH a lock file and a platform hit
    // shows up once. Empty Vec on platforms we don't support.
    if let Ok(extras) = scan_platform_native().await {
        for extra in extras {
            if !records.iter().any(|r| r.pid == extra.pid) {
                records.push(extra);
            }
        }
    }

    records
}

// ---------------------------------------------------------------------------
// Lock-file fast path
// ---------------------------------------------------------------------------

fn runtime_dir() -> Option<PathBuf> {
    let home = home_dir()?;
    Some(home.join(".vskill").join("runtime"))
}

fn home_dir() -> Option<PathBuf> {
    if let Some(h) = std::env::var_os("HOME") {
        return Some(PathBuf::from(h));
    }
    if cfg!(target_os = "windows") {
        if let Some(p) = std::env::var_os("USERPROFILE") {
            return Some(PathBuf::from(p));
        }
    }
    None
}

#[derive(Debug, Deserialize)]
struct LockFileV1 {
    pid: u32,
    port: u16,
    #[serde(default)]
    cmdline: String,
    #[serde(rename = "startedAt")]
    started_at: String,
    #[serde(default)]
    source: Option<String>,
}

/// Enumerate `~/.vskill/runtime/studio-*.lock`, prune stale, return live.
fn scan_lock_files() -> Vec<ProcessRecord> {
    match runtime_dir() {
        Some(d) => scan_lock_files_in(&d),
        None => Vec::new(),
    }
}

/// Test-friendly entry point that reads from an explicit runtime dir.
/// Production callers go through `scan_lock_files()` which resolves
/// `$HOME/.vskill/runtime/`.
fn scan_lock_files_in(dir: &Path) -> Vec<ProcessRecord> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.starts_with("studio-") || !name.ends_with(".lock") {
            continue;
        }

        let lock = match parse_lock(&path) {
            Some(l) => l,
            None => {
                // Unparseable — treat as stale and remove.
                let _ = std::fs::remove_file(&path);
                continue;
            }
        };

        if lock_is_stale(&lock) {
            log::info!(
                "process_discovery: pruning stale lock {} (pid={} not alive or cmdline changed)",
                path.display(),
                lock.pid
            );
            let _ = std::fs::remove_file(&path);
            continue;
        }

        out.push(ProcessRecord {
            pid: lock.pid,
            port: lock.port,
            started_at: lock.started_at,
            source: lock
                .source
                .as_deref()
                .map(ProcessSource::from_str_lossy)
                .unwrap_or(ProcessSource::NpxCli),
            cmdline: truncate_cmdline(&lock.cmdline),
        });
    }
    out
}

fn parse_lock(path: &Path) -> Option<LockFileV1> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice::<LockFileV1>(&bytes).ok()
}

fn lock_is_stale(lock: &LockFileV1) -> bool {
    // 1) >1d old? Treat unparseable timestamps as stale too — F-LOGIC-03
    //    review pass 2: a lock with corrupted `startedAt` would otherwise
    //    persist indefinitely as long as its PID happens to be alive.
    match age_seconds(&lock.started_at) {
        Some(age) if age > STALE_LOCK_AGE_SECS => return true,
        Some(_) => {}
        None => {
            log::warn!(
                "process_discovery: lock for pid {} has unparseable startedAt={:?} — treating as stale",
                lock.pid,
                lock.started_at
            );
            return true;
        }
    }
    // 2) PID dead?
    if !pid_is_alive(lock.pid) {
        return true;
    }
    // 3) PID reused (cmdline mismatch)?
    if let Some(cmd) = read_pid_cmdline(lock.pid) {
        if !cmd.contains(VSKILL_MARKER) && !lock.cmdline.is_empty() {
            // Lock file still claims our marker but the live process doesn't —
            // PID was reused by something else. Treat as stale.
            return true;
        }
    }
    false
}

fn age_seconds(iso: &str) -> Option<i64> {
    let parsed = parse_iso8601_to_unix(iso)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .ok()?;
    Some(now - parsed)
}

/// Parse a small subset of ISO-8601 — exactly what `new Date().toISOString()`
/// emits: `YYYY-MM-DDTHH:MM:SS.sssZ`. Anything else returns None.
fn parse_iso8601_to_unix(iso: &str) -> Option<i64> {
    if iso.len() < 20 {
        return None;
    }
    let bytes = iso.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = iso.get(0..4)?.parse().ok()?;
    let month: u32 = iso.get(5..7)?.parse().ok()?;
    let day: u32 = iso.get(8..10)?.parse().ok()?;
    let hour: u32 = iso.get(11..13)?.parse().ok()?;
    let min: u32 = iso.get(14..16)?.parse().ok()?;
    let sec: u32 = iso.get(17..19)?.parse().ok()?;

    // Civil-from-Gregorian (Howard Hinnant). Returns days since 1970-01-01.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64;
    let m = month as u64;
    let d = day as u64;
    let doy = (153 * if m > 2 { m - 3 } else { m + 9 } + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch = era * 146_097 + doe as i64 - 719_468;
    Some(
        days_since_epoch * 86_400
            + (hour as i64) * 3600
            + (min as i64) * 60
            + (sec as i64),
    )
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    // 0832 F-003: capture errno explicitly between the kill call and
    // last_os_error() so a future libc call inserted in between can't
    // silently break liveness detection.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if rc == 0 {
        return true;
    }
    // EPERM means the PID exists but we can't signal it (different uid).
    // ESRCH means the PID doesn't exist. Treat EPERM as alive — the lock
    // owner is real, we just can't kill it; that's the scanner's signal
    // that the lock is NOT stale.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    // Windows: `tasklist /FI "PID eq N"` — not perfect but doesn't require
    // PowerShell. We fall back to "alive" if we can't determine — pruning is
    // best-effort on Windows.
    let _ = pid;
    true
}

#[cfg(unix)]
fn read_pid_cmdline(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        // /proc/{pid}/cmdline is null-separated.
        let p = format!("/proc/{}/cmdline", pid);
        let bytes = std::fs::read(&p).ok()?;
        let s: String = bytes
            .split(|b| *b == 0)
            .filter_map(|chunk| std::str::from_utf8(chunk).ok())
            .collect::<Vec<_>>()
            .join(" ");
        Some(s)
    }
    #[cfg(target_os = "macos")]
    {
        // `ps -o command= -p PID` — synchronous, single-line. Tiny binary
        // that's been on macOS since forever.
        let out = std::process::Command::new("ps")
            .args(["-o", "command=", "-p", &pid.to_string()])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if line.is_empty() {
            None
        } else {
            Some(line)
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

#[cfg(not(unix))]
fn read_pid_cmdline(_pid: u32) -> Option<String> {
    None
}

fn truncate_cmdline(s: &str) -> String {
    if s.len() <= 120 {
        s.to_string()
    } else {
        format!("{}...", &s[..117])
    }
}

// ---------------------------------------------------------------------------
// Platform-native fallback
// ---------------------------------------------------------------------------

async fn scan_platform_native() -> Result<Vec<ProcessRecord>, String> {
    if cfg!(target_os = "macos") {
        scan_macos().await
    } else if cfg!(target_os = "linux") {
        scan_linux().await
    } else if cfg!(target_os = "windows") {
        scan_windows().await
    } else {
        Ok(Vec::new())
    }
}

#[cfg(target_os = "macos")]
async fn scan_macos() -> Result<Vec<ProcessRecord>, String> {
    // 1) `pgrep -f vskill-server` AND `pgrep -f "node.*vskill.*studio"` to
    //    catch both the Tauri sidecar and standalone CLI starts.
    let pids_a = pgrep_f("vskill-server").await.unwrap_or_default();
    let pids_b = pgrep_f("vskill.*studio").await.unwrap_or_default();

    let mut all_pids: Vec<u32> = pids_a.into_iter().chain(pids_b).collect();
    all_pids.sort();
    all_pids.dedup();

    let mut out = Vec::new();
    for pid in all_pids {
        if let Some(rec) = build_record_for_pid(pid).await {
            out.push(rec);
        }
    }
    Ok(out)
}

#[cfg(not(target_os = "macos"))]
async fn scan_macos() -> Result<Vec<ProcessRecord>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "linux")]
async fn scan_linux() -> Result<Vec<ProcessRecord>, String> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir("/proc") {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let pid = match entry
            .file_name()
            .to_string_lossy()
            .parse::<u32>()
        {
            Ok(p) => p,
            Err(_) => continue,
        };
        let cmd = match read_pid_cmdline(pid) {
            Some(c) => c,
            None => continue,
        };
        if !cmd.contains(VSKILL_MARKER) {
            continue;
        }
        // Heuristic: only ours if it mentions vskill-server or "studio".
        if !cmd.contains("vskill-server") && !cmd.contains("studio") {
            continue;
        }
        if let Some(rec) = build_record_for_pid(pid).await {
            out.push(rec);
        }
    }
    Ok(out)
}

#[cfg(not(target_os = "linux"))]
async fn scan_linux() -> Result<Vec<ProcessRecord>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
async fn scan_windows() -> Result<Vec<ProcessRecord>, String> {
    // PowerShell Get-CimInstance — Get-NetTCPConnection joined with
    // Get-Process by OwningProcess. Returns lines of "PID PORT".
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-NetTCPConnection -State Listen | ForEach-Object { $p=Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and ($p.ProcessName -like '*vskill*' -or $p.ProcessName -like '*node*')) { '{0} {1}' -f $p.Id, $_.LocalPort } }",
        ])
        .stdout(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("powershell launch failed: {e}"))?;
    let mut out = Vec::new();
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let pid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        let port: u16 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        out.push(ProcessRecord {
            pid,
            port,
            started_at: String::new(),
            source: ProcessSource::NodeDirect,
            cmdline: String::new(),
        });
    }
    Ok(out)
}

#[cfg(not(target_os = "windows"))]
async fn scan_windows() -> Result<Vec<ProcessRecord>, String> {
    Ok(Vec::new())
}

#[cfg(unix)]
async fn pgrep_f(pattern: &str) -> Result<Vec<u32>, String> {
    let out = Command::new("pgrep")
        .args(["-f", pattern])
        .stdout(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("pgrep launch failed: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let pids: Vec<u32> = text
        .lines()
        .filter_map(|l| l.trim().parse().ok())
        .collect();
    Ok(pids)
}

#[cfg(unix)]
async fn build_record_for_pid(pid: u32) -> Option<ProcessRecord> {
    if !pid_is_alive(pid) {
        return None;
    }
    let cmdline = read_pid_cmdline(pid).unwrap_or_default();
    let port = lsof_listen_port(pid).await.unwrap_or(0);
    let source = classify_source(&cmdline);
    Some(ProcessRecord {
        pid,
        port,
        started_at: String::new(),
        source,
        cmdline: truncate_cmdline(&cmdline),
    })
}

#[cfg(unix)]
async fn lsof_listen_port(pid: u32) -> Option<u16> {
    let out = Command::new("lsof")
        .args([
            "-p",
            &pid.to_string(),
            "-P",
            "-n",
            "-iTCP",
            "-sTCP:LISTEN",
            "-Fn",
        ])
        .stdout(Stdio::piped())
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    // -F output: lines beginning with `n` carry the name (e.g. `n*:7077`).
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix('n') {
            if let Some(idx) = rest.rfind(':') {
                let port_str = &rest[idx + 1..];
                if let Ok(p) = port_str.parse::<u16>() {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[cfg(not(unix))]
async fn build_record_for_pid(_pid: u32) -> Option<ProcessRecord> {
    None
}

fn classify_source(cmdline: &str) -> ProcessSource {
    if cmdline.contains("vskill-server") {
        // Tauri sidecar binary — distinguishable by exact name.
        return ProcessSource::Tauri;
    }
    if cmdline.contains("npx") || cmdline.contains("npm exec") {
        return ProcessSource::NpxCli;
    }
    ProcessSource::NodeDirect
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::SystemTime;

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Each test gets a fresh runtime dir; we test `scan_lock_files_in()`
    /// directly so parallel tests don't race on $HOME.
    fn fresh_runtime_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let nanos = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir()
            .join(format!("vskill-procdisc-test-{pid}-{nanos}-{n}"))
            .join(".vskill")
            .join("runtime");
        std::fs::create_dir_all(&dir).expect("create runtime dir");
        dir
    }

    fn write_lock_at(runtime: &Path, port: u16, payload: &str) {
        let p = runtime.join(format!("studio-{port}.lock"));
        std::fs::write(p, payload).unwrap();
    }

    #[test]
    fn scan_lock_files_returns_record_for_valid_lock() {
        let runtime = fresh_runtime_dir();
        // Use our own PID so the alive-check passes; ISO timestamp = now.
        let pid = std::process::id();
        let now = chrono_lite_now();
        let payload = format!(
            r#"{{"pid":{pid},"port":7077,"cmdline":"node vskill studio --port 7077","startedAt":"{now}","source":"npx-cli"}}"#
        );
        write_lock_at(&runtime, 7077, &payload);

        let records = scan_lock_files_in(&runtime);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].port, 7077);
        assert_eq!(records[0].pid, pid);
        assert_eq!(records[0].source, ProcessSource::NpxCli);
    }

    #[test]
    fn scan_lock_files_prunes_dead_pid() {
        let runtime = fresh_runtime_dir();
        // PID 999_999_999 isn't alive on any real system.
        let now = chrono_lite_now();
        let payload = format!(
            r#"{{"pid":999999999,"port":7078,"cmdline":"node vskill studio","startedAt":"{now}","source":"npx-cli"}}"#
        );
        write_lock_at(&runtime, 7078, &payload);

        let records = scan_lock_files_in(&runtime);
        assert_eq!(records.len(), 0);
        // File should be gone after the prune.
        assert!(!runtime.join("studio-7078.lock").exists());
    }

    #[test]
    fn scan_lock_files_prunes_stale_old_lock() {
        let runtime = fresh_runtime_dir();
        // Y2K-era timestamp triggers the >1d branch before we even check PID.
        let pid = std::process::id();
        let payload = format!(
            r#"{{"pid":{pid},"port":7079,"cmdline":"node vskill studio","startedAt":"2000-01-01T00:00:00.000Z","source":"npx-cli"}}"#
        );
        write_lock_at(&runtime, 7079, &payload);

        let records = scan_lock_files_in(&runtime);
        assert_eq!(records.len(), 0);
        assert!(!runtime.join("studio-7079.lock").exists());
    }

    #[test]
    fn scan_lock_files_prunes_unparseable_lock() {
        let runtime = fresh_runtime_dir();
        write_lock_at(&runtime, 7080, "not json {{{");
        let records = scan_lock_files_in(&runtime);
        assert_eq!(records.len(), 0);
        assert!(!runtime.join("studio-7080.lock").exists());
    }

    #[test]
    fn scan_lock_files_handles_multiple_locks() {
        let runtime = fresh_runtime_dir();
        let pid = std::process::id();
        let now = chrono_lite_now();
        for port in [7077u16, 7078, 7079] {
            let payload = format!(
                r#"{{"pid":{pid},"port":{port},"cmdline":"node vskill studio","startedAt":"{now}","source":"npx-cli"}}"#
            );
            write_lock_at(&runtime, port, &payload);
        }
        let mut records = scan_lock_files_in(&runtime);
        records.sort_by_key(|r| r.port);
        let ports: Vec<u16> = records.iter().map(|r| r.port).collect();
        assert_eq!(ports, vec![7077, 7078, 7079]);
    }

    #[test]
    fn scan_lock_files_returns_empty_when_runtime_dir_missing() {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("vskill-procdisc-empty-{n}"));
        // Don't create .vskill/runtime — read of nonexistent dir → empty.
        let records = scan_lock_files_in(&dir.join(".vskill").join("runtime"));
        assert_eq!(records.len(), 0);
    }

    #[test]
    fn truncate_cmdline_caps_at_120_chars() {
        let long = "x".repeat(500);
        let out = truncate_cmdline(&long);
        assert!(out.len() <= 120);
        assert!(out.ends_with("..."));
    }

    #[test]
    fn process_source_from_str_lossy_handles_unknown() {
        assert_eq!(ProcessSource::from_str_lossy("tauri"), ProcessSource::Tauri);
        assert_eq!(
            ProcessSource::from_str_lossy("node-direct"),
            ProcessSource::NodeDirect
        );
        // Anything unknown falls back to NpxCli (lock files written by the CLI
        // never set source="" but defensive default catches future variants).
        assert_eq!(
            ProcessSource::from_str_lossy("nope"),
            ProcessSource::NpxCli
        );
    }

    #[test]
    fn classify_source_recognizes_vskill_server() {
        assert_eq!(
            classify_source("/path/to/vskill-server --port 0"),
            ProcessSource::Tauri
        );
    }

    #[test]
    fn classify_source_recognizes_npx() {
        assert_eq!(
            classify_source("/usr/bin/npx vskill@latest studio"),
            ProcessSource::NpxCli
        );
    }

    #[test]
    fn classify_source_falls_back_to_node_direct() {
        assert_eq!(
            classify_source("/usr/local/bin/node /path/to/dist/bin.js studio"),
            ProcessSource::NodeDirect
        );
    }

    #[tokio::test]
    async fn scan_top_level_returns_within_budget() {
        // Contract: scan() returns Ok(_) within the 500ms timeout. We don't
        // mutate $HOME here (parallel tests would race) — we just verify the
        // top-level call returns successfully against the real environment.
        let started = std::time::Instant::now();
        let result = scan().await.expect("scan must return Ok");
        let elapsed = started.elapsed();
        // 500ms hard timeout + some scheduler jitter — generous bound.
        assert!(
            elapsed < Duration::from_millis(1500),
            "scan took {elapsed:?}, exceeds bound"
        );
        let _ = result;
    }

    #[test]
    fn process_record_serializes_started_at_as_camel_case() {
        // 0832 F-GRILL-01 regression test: the React LifecycleApp reads
        // `detected.startedAt` (camelCase). If anyone removes the
        // `#[serde(rename_all = "camelCase")]` attr on ProcessRecord, the
        // modal silently shows "just now" forever. Lock that contract here.
        let rec = ProcessRecord {
            pid: 4321,
            port: 7077,
            started_at: "2026-05-07T19:00:00.000Z".to_string(),
            source: ProcessSource::NpxCli,
            cmdline: "node vskill studio".to_string(),
        };
        let json = serde_json::to_string(&rec).expect("serialize");
        assert!(
            json.contains("\"startedAt\":\"2026-05-07T19:00:00.000Z\""),
            "ProcessRecord must serialize startedAt as camelCase: {json}"
        );
        assert!(
            !json.contains("started_at"),
            "ProcessRecord must NOT emit snake_case started_at: {json}"
        );
        // Other fields are single-word — camelCase is a no-op for them.
        assert!(json.contains("\"pid\":4321"));
        assert!(json.contains("\"port\":7077"));
        // ProcessSource has its own kebab-case rename.
        assert!(json.contains("\"source\":\"npx-cli\""));
    }

    #[test]
    fn parse_iso8601_roundtrip() {
        let unix = parse_iso8601_to_unix("2026-01-15T12:34:56.789Z").unwrap();
        // Sanity: 2026-01-15 12:34:56 UTC is 56 years + change after 1970.
        assert!(unix > 1_700_000_000); // after Nov 2023
        assert!(unix < 2_000_000_000); // before May 2033
    }

    #[test]
    fn parse_iso8601_rejects_garbage() {
        assert!(parse_iso8601_to_unix("not a date").is_none());
        assert!(parse_iso8601_to_unix("2026/01/15").is_none());
        assert!(parse_iso8601_to_unix("").is_none());
    }

    /// Tiny helper — emit `YYYY-MM-DDTHH:MM:SS.000Z` for "now" without
    /// pulling in chrono. Good enough for the test fixtures.
    fn chrono_lite_now() -> String {
        let secs = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
        format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.000Z")
    }

    fn unix_to_ymdhms(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
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
}
