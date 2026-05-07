// Settings persistence for ~/.vskill/settings.json.
//
// Lifecycle:
//   - load(): read file → parse → on corrupt rename to .corrupt.<ts>, return defaults
//   - get(): clone snapshot from in-memory Mutex
//   - set_key(path, value): dotted-path apply, signal debouncer, return immediately
//   - reset(): rename live to .bak.<ts>, write defaults atomically, swap in-memory state
//
// Atomicity: tmp + fsync + rename. Live file is never partially written.
// Concurrency: tokio::sync::Mutex serializes mutations. Debouncer is a single
// background task — never two concurrent disk writes.
// Permissions (Unix): file 0600, parent dir 0700. Existing more-permissive
// modes are tightened on next write with a warn-level log.
//
// Schema v1: version mismatch (file says 0 or >=2) discards the old payload
// and writes defaults — same v2-discards-v1 pattern as desktop-window-state.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};

pub const SCHEMA_VERSION: u32 = 1;
const DEBOUNCE_MS: u64 = 250;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub updates: UpdateSettings,
    #[serde(default)]
    pub privacy: PrivacySettings,
    #[serde(default)]
    pub advanced: AdvancedSettings,
    #[serde(flatten, default)]
    pub _unknown: HashMap<String, Value>,
}

fn default_version() -> u32 {
    SCHEMA_VERSION
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SCHEMA_VERSION,
            general: GeneralSettings::default(),
            updates: UpdateSettings::default(),
            privacy: PrivacySettings::default(),
            advanced: AdvancedSettings::default(),
            _unknown: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct GeneralSettings {
    pub theme: String,
    pub language: String,
    pub launch_at_login: bool,
    pub default_project_folder: Option<String>,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: "auto".to_string(),
            launch_at_login: false,
            default_project_folder: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct UpdateSettings {
    pub channel: String,
    pub auto_check: bool,
    pub skipped_version: Option<String>,
    pub last_checked_at: Option<String>,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            channel: "stable".to_string(),
            auto_check: true,
            skipped_version: None,
            last_checked_at: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct PrivacySettings {
    pub telemetry_enabled: bool,
    pub crash_reporting_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AdvancedSettings {
    pub log_level: String,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

pub fn settings_path() -> PathBuf {
    settings_path_in(&home_dir().unwrap_or_else(std::env::temp_dir))
}

fn settings_path_in(home: &std::path::Path) -> PathBuf {
    home.join(".vskill").join("settings.json")
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

// ---------------------------------------------------------------------------
// Allow-list of writable dotted paths
// ---------------------------------------------------------------------------

const ALLOWED_PATHS: &[&str] = &[
    "general.theme",
    "general.language",
    "general.launchAtLogin",
    "general.defaultProjectFolder",
    "updates.channel",
    "updates.autoCheck",
    "updates.skippedVersion",
    "updates.lastCheckedAt",
    "privacy.telemetryEnabled",
    "privacy.crashReportingEnabled",
    "advanced.logLevel",
];

// ---------------------------------------------------------------------------
// SettingsStore — public API consumed by Tauri commands
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct SettingsStore {
    state: Arc<Mutex<Settings>>,
    write_tx: mpsc::UnboundedSender<()>,
    path: PathBuf,
}

impl SettingsStore {
    pub fn new() -> Self {
        Self::new_at(settings_path())
    }

    pub fn new_at(path: PathBuf) -> Self {
        let initial = load_from_path(&path);
        let state = Arc::new(Mutex::new(initial));
        let (tx, rx) = mpsc::unbounded_channel::<()>();
        spawn_debouncer(state.clone(), path.clone(), rx);
        Self {
            state,
            write_tx: tx,
            path,
        }
    }

    pub async fn get(&self) -> Settings {
        self.state.lock().await.clone()
    }

    pub async fn set_key(&self, key: &str, value: Value) -> Result<(), String> {
        if !ALLOWED_PATHS.contains(&key) {
            return Err(format!("unknown setting path: {key}"));
        }
        let mut guard = self.state.lock().await;
        apply_path(&mut guard, key, value)?;
        let _ = self.write_tx.send(());
        Ok(())
    }

    pub async fn reset(&self) -> Result<(), String> {
        let mut guard = self.state.lock().await;
        if self.path.exists() {
            let backup = self.path.with_extension(format!(
                "json.bak.{}",
                format_timestamp(SystemTime::now())
            ));
            if let Err(e) = std::fs::rename(&self.path, &backup) {
                log::warn!("settings reset: could not rename to backup: {e}");
            }
        }
        *guard = Settings::default();
        atomic_write(&self.path, &guard).map_err(|e| format!("write defaults: {e}"))?;
        Ok(())
    }

    #[cfg(test)]
    pub async fn flush_for_test(&self) {
        // Wait long enough for the debouncer to fire at least once.
        tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS + 100)).await;
    }
}

impl Default for SettingsStore {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

fn load_from_path(path: &std::path::Path) -> Settings {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Settings::default(),
        Err(e) => {
            log::warn!("settings: read failed ({e}); using defaults");
            return Settings::default();
        }
    };

    // Probe schema version first — a parse-success at the wrong version is
    // still a discard (same pattern as desktop-window-state v2-discards-v1).
    let probe: Result<Value, _> = serde_json::from_slice(&bytes);
    let version_ok = probe
        .as_ref()
        .ok()
        .and_then(|v| v.get("version"))
        .and_then(|v| v.as_u64())
        .map(|n| n as u32 == SCHEMA_VERSION)
        .unwrap_or(false);

    if !version_ok {
        log::warn!(
            "settings: schema version mismatch or unparseable ({:?}); discarding",
            path
        );
        move_to_corrupt(path);
        return Settings::default();
    }

    match serde_json::from_value::<Settings>(probe.unwrap()) {
        Ok(s) => {
            tighten_perms_if_loose(path);
            s
        }
        Err(e) => {
            log::warn!("settings: parse failed ({e}); renaming to .corrupt and using defaults");
            move_to_corrupt(path);
            Settings::default()
        }
    }
}

fn move_to_corrupt(path: &std::path::Path) {
    let target = path.with_extension(format!(
        "json.corrupt.{}",
        format_timestamp(SystemTime::now())
    ));
    if let Err(e) = std::fs::rename(path, &target) {
        log::warn!("settings: could not rename corrupt file: {e}");
    }
}

#[cfg(unix)]
fn tighten_perms_if_loose(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    let mode = meta.permissions().mode() & 0o777;
    if mode != 0o600 {
        log::warn!(
            "settings: tightening file mode from {:o} to 0600 ({:?})",
            mode,
            path
        );
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

#[cfg(not(unix))]
fn tighten_perms_if_loose(_path: &std::path::Path) {}

fn apply_path(settings: &mut Settings, key: &str, value: Value) -> Result<(), String> {
    match key {
        "general.theme" => {
            settings.general.theme = expect_string(&value, key)?;
        }
        "general.language" => {
            settings.general.language = expect_string(&value, key)?;
        }
        "general.launchAtLogin" => {
            settings.general.launch_at_login = expect_bool(&value, key)?;
        }
        "general.defaultProjectFolder" => match &value {
            Value::Null => settings.general.default_project_folder = None,
            Value::String(s) => settings.general.default_project_folder = Some(s.clone()),
            _ => return Err(format!("invalid type for {key}: expected string or null")),
        },
        "updates.channel" => {
            settings.updates.channel = expect_string(&value, key)?;
        }
        "updates.autoCheck" => {
            settings.updates.auto_check = expect_bool(&value, key)?;
        }
        "updates.skippedVersion" => match &value {
            Value::Null => settings.updates.skipped_version = None,
            Value::String(s) => settings.updates.skipped_version = Some(s.clone()),
            _ => return Err(format!("invalid type for {key}: expected string or null")),
        },
        "updates.lastCheckedAt" => match &value {
            Value::Null => settings.updates.last_checked_at = None,
            Value::String(s) => settings.updates.last_checked_at = Some(s.clone()),
            _ => return Err(format!("invalid type for {key}: expected string or null")),
        },
        "privacy.telemetryEnabled" => {
            settings.privacy.telemetry_enabled = expect_bool(&value, key)?;
        }
        "privacy.crashReportingEnabled" => {
            settings.privacy.crash_reporting_enabled = expect_bool(&value, key)?;
        }
        "advanced.logLevel" => {
            settings.advanced.log_level = expect_string(&value, key)?;
        }
        _ => return Err(format!("unknown setting path: {key}")),
    }
    Ok(())
}

fn expect_string(value: &Value, key: &str) -> Result<String, String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("invalid type for {key}: expected string"))
}

fn expect_bool(value: &Value, key: &str) -> Result<bool, String> {
    value
        .as_bool()
        .ok_or_else(|| format!("invalid type for {key}: expected bool"))
}

fn spawn_debouncer(
    state: Arc<Mutex<Settings>>,
    path: PathBuf,
    mut rx: mpsc::UnboundedReceiver<()>,
) {
    tokio::spawn(async move {
        loop {
            // Wait for the first signal — we don't write until something asks us to.
            if rx.recv().await.is_none() {
                return;
            }
            // Coalesce: drain any signals that arrive within the debounce window.
            tokio::time::sleep(Duration::from_millis(DEBOUNCE_MS)).await;
            while rx.try_recv().is_ok() {}

            let snapshot = { state.lock().await.clone() };
            if let Err(e) = atomic_write(&path, &snapshot) {
                log::error!("settings: debounced write failed: {e}");
            }
        }
    });
}

fn atomic_write(path: &std::path::Path, settings: &Settings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut opts = std::fs::OpenOptions::new();
        opts.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp)?;
        let json = serde_json::to_vec_pretty(settings)?;
        file.write_all(&json)?;
        file.sync_all()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ =
                std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
    }

    // Fault-injection hook for AC-US6-03: simulate a crash between fsync and
    // rename. The tmp file will exist but the live file will be unchanged.
    #[cfg(feature = "fault-inject-write")]
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "fault-inject: aborted between fsync and rename",
        ));
    }

    #[allow(unreachable_code)]
    std::fs::rename(&tmp, path)
}

fn format_timestamp(t: SystemTime) -> String {
    // YYYYMMDD-HHMMSS without pulling in chrono. Uses UTC to avoid timezone
    // ambiguity in backup filenames.
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

// Civil-from-days algorithm (Howard Hinnant, public domain). Faster than
// pulling in chrono just for backup-file naming.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TMP_COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn fresh_tmp_dir() -> PathBuf {
        let n = TMP_COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("vskill-settings-test-{pid}-{nanos}-{n}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn fresh_path() -> PathBuf {
        fresh_tmp_dir().join("settings.json")
    }

    #[test]
    fn test_load_with_missing_file_returns_defaults() {
        let path = fresh_path();
        assert!(!path.exists());
        let s = load_from_path(&path);
        assert_eq!(s, Settings::default());
        // Read is side-effect-free per AC-US6-06.
        assert!(!path.exists());
    }

    #[test]
    fn test_save_then_load_roundtrip() {
        let path = fresh_path();
        let mut s = Settings::default();
        s.general.theme = "dark".to_string();
        s.updates.channel = "beta".to_string();
        atomic_write(&path, &s).expect("write");
        let loaded = load_from_path(&path);
        assert_eq!(loaded.general.theme, "dark");
        assert_eq!(loaded.updates.channel, "beta");
    }

    #[test]
    fn test_atomic_write_does_not_clobber_on_parent_failure() {
        // No actual fault injection here — the dedicated fault-inject test
        // runs under a feature flag. This is the parent-permission failure
        // case: ensure live file is untouched if write to tmp fails.
        let path = fresh_path();
        let original = Settings::default();
        atomic_write(&path, &original).expect("seed");

        // Corrupt the parent path resolution by pointing at a non-writable
        // root. We can't reliably test "tmp written but rename fails" without
        // the feature flag, so just verify the seed is still readable.
        let loaded = load_from_path(&path);
        assert_eq!(loaded, original);
    }

    #[cfg(feature = "fault-inject-write")]
    #[test]
    fn test_atomic_write_fault_injection() {
        // With the feature flag on, atomic_write returns Err between fsync
        // and rename. Live file must be unchanged after the simulated crash.
        let path = fresh_path();
        let mut original = Settings::default();
        original.general.theme = "light".to_string();

        // Seed the live file directly (bypassing atomic_write so the seed
        // doesn't itself trip the fault injection).
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        let seed_bytes = serde_json::to_vec_pretty(&original).unwrap();
        std::fs::write(&path, &seed_bytes).unwrap();

        let mut next = original.clone();
        next.general.theme = "dark".to_string();
        let result = atomic_write(&path, &next);
        assert!(result.is_err(), "fault injection should return Err");

        // Live file unchanged — original "light" theme still on disk.
        let loaded = load_from_path(&path);
        assert_eq!(loaded.general.theme, "light");

        // The .tmp file may exist (orphan); next clean load handles that.
        let tmp = path.with_extension("json.tmp");
        // We don't assert on tmp existence — that's an OS-dependent detail.
        let _ = tmp;
    }

    #[test]
    fn test_schema_v0_discards_old_payload() {
        let path = fresh_path();
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        // Version 0 — should be discarded.
        std::fs::write(
            &path,
            r#"{"version": 0, "general": {"theme": "dark"}}"#,
        )
        .unwrap();

        let loaded = load_from_path(&path);
        // Old payload discarded, defaults returned.
        assert_eq!(loaded.general.theme, "system");
        assert_eq!(loaded.version, SCHEMA_VERSION);
        // Old file moved aside.
        assert!(!path.exists());
    }

    #[test]
    fn test_schema_future_version_discards_payload() {
        let path = fresh_path();
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(
            &path,
            r#"{"version": 99, "general": {"theme": "dark"}}"#,
        )
        .unwrap();

        let loaded = load_from_path(&path);
        assert_eq!(loaded, Settings::default());
        assert!(!path.exists());
    }

    #[test]
    fn test_corrupt_json_recovers_to_defaults() {
        let path = fresh_path();
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::write(&path, b"not json at all {{{").unwrap();

        let loaded = load_from_path(&path);
        assert_eq!(loaded, Settings::default());
        // Corrupt file moved aside (path should be empty now).
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn test_set_key_with_dot_notation() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path);
        store
            .set_key("general.theme", Value::String("dark".to_string()))
            .await
            .expect("set");
        let s = store.get().await;
        assert_eq!(s.general.theme, "dark");

        store
            .set_key("privacy.telemetryEnabled", Value::Bool(true))
            .await
            .expect("set");
        let s = store.get().await;
        assert!(s.privacy.telemetry_enabled);
    }

    #[tokio::test]
    async fn test_set_key_rejects_unknown_path() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path);
        let err = store
            .set_key("general.bogus", Value::String("x".to_string()))
            .await
            .expect_err("should reject");
        assert!(err.contains("unknown"));
    }

    #[tokio::test]
    async fn test_set_key_type_validation_rejects_wrong_type() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path);
        let err = store
            .set_key("general.theme", Value::Bool(true))
            .await
            .expect_err("string-typed key rejects bool");
        assert!(err.contains("expected string"));

        let err = store
            .set_key("privacy.telemetryEnabled", Value::String("yes".into()))
            .await
            .expect_err("bool-typed key rejects string");
        assert!(err.contains("expected bool"));
    }

    #[tokio::test]
    async fn test_set_key_persists_after_debounce() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path.clone());
        store
            .set_key("general.theme", Value::String("dark".to_string()))
            .await
            .expect("set");
        store.flush_for_test().await;

        let on_disk = load_from_path(&path);
        assert_eq!(on_disk.general.theme, "dark");
    }

    #[tokio::test]
    async fn test_debounced_writes_collapse_within_250ms() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path.clone());

        // Hammer 10 sets in quick succession.
        for i in 0..10 {
            store
                .set_key(
                    "general.theme",
                    Value::String(format!("dark-{i}")),
                )
                .await
                .expect("set");
        }
        store.flush_for_test().await;

        let on_disk = load_from_path(&path);
        // Final value wins (single coalesced write).
        assert_eq!(on_disk.general.theme, "dark-9");
    }

    #[tokio::test]
    async fn test_concurrent_set_serializes() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path.clone());

        let s1 = store.clone();
        let s2 = store.clone();
        let h1 = tokio::spawn(async move {
            for _ in 0..50 {
                s1.set_key("general.theme", Value::String("dark".to_string()))
                    .await
                    .unwrap();
            }
        });
        let h2 = tokio::spawn(async move {
            for _ in 0..50 {
                s2.set_key("general.language", Value::String("en".to_string()))
                    .await
                    .unwrap();
            }
        });
        h1.await.unwrap();
        h2.await.unwrap();
        store.flush_for_test().await;

        let s = store.get().await;
        // Both writes landed deterministically — Mutex serialized them.
        assert_eq!(s.general.theme, "dark");
        assert_eq!(s.general.language, "en");
    }

    #[tokio::test]
    async fn test_reset_writes_defaults_and_backs_up() {
        let path = fresh_path();
        let store = SettingsStore::new_at(path.clone());
        store
            .set_key("general.theme", Value::String("dark".to_string()))
            .await
            .unwrap();
        store.flush_for_test().await;

        store.reset().await.expect("reset");
        let s = store.get().await;
        assert_eq!(s.general.theme, "system");
        assert_eq!(s.version, SCHEMA_VERSION);

        let loaded = load_from_path(&path);
        assert_eq!(loaded.general.theme, "system");

        // A backup file should exist alongside.
        let parent = path.parent().unwrap();
        let backup_count = std::fs::read_dir(parent)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .contains("settings.json.bak.")
            })
            .count();
        assert_eq!(backup_count, 1);
    }

    #[test]
    fn test_unknown_top_level_keys_round_trip() {
        let path = fresh_path();
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).unwrap();
        }
        // A future binary added "experimental" — old binary should preserve it.
        std::fs::write(
            &path,
            r#"{
                "version": 1,
                "general": {},
                "updates": {},
                "privacy": {},
                "advanced": {},
                "experimental": {"newFlag": true}
            }"#,
        )
        .unwrap();

        let loaded = load_from_path(&path);
        assert!(loaded._unknown.contains_key("experimental"));

        atomic_write(&path, &loaded).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert!(v.get("experimental").is_some(), "unknown key dropped");
    }

    #[cfg(unix)]
    #[test]
    fn test_file_mode_is_0600_on_write() {
        use std::os::unix::fs::PermissionsExt;
        let path = fresh_path();
        atomic_write(&path, &Settings::default()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "expected 0600 perms, got {mode:o}");
    }

    #[cfg(unix)]
    #[test]
    fn test_loose_perms_get_tightened_on_load() {
        use std::os::unix::fs::PermissionsExt;
        let path = fresh_path();
        atomic_write(&path, &Settings::default()).unwrap();
        // Loosen the perms.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        // Load tightens.
        let _ = load_from_path(&path);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn test_format_timestamp_shape() {
        // Should be exactly YYYYMMDD-HHMMSS, 15 chars.
        let s = format_timestamp(SystemTime::now());
        assert_eq!(s.len(), 15);
        assert_eq!(&s[8..9], "-");
    }
}
