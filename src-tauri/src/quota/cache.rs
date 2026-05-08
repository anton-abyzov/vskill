// 0831 quota::cache — disk-backed quota response cache.
//
// Serialization target: `~/.vskill/cache/quota.json` (NOT settings.json — the
// quota response is a frequently-updated server snapshot and lives in `cache/`
// next to identity.json. settings.json stays stable user-preferences only).
//
// Wire shape: mirrors `vskill-platform/src/lib/billing/quota-shape.ts::QuotaResponse`.
// Per the agent coordination contract we DUPLICATE the type rather than
// import — cross-repo shared types violate the umbrella-repo boundary.
//
// Freshness rule (ADR-0831-05):
//   fresh_until = serverNow_at_last_sync + GRACE_PERIOD_DAYS
//   skew_ms     = local_now_at_sync - parsed(serverNow)
//   is_fresh()  = (skew_adjusted_now() < fresh_until)
//
// is_fresh() is computed on the SERVER's clock, not the local clock — a user
// with a stuck/wrong machine clock can't lock themselves out OR get free
// unlimited time.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Free-tier limit constant. Mirrors platform's `FREE_TIER_SKILL_LIMIT`.
/// Re-exported for downstream consumers; not yet referenced in this PR.
#[allow(dead_code)]
pub const FREE_TIER_SKILL_LIMIT: i64 = 50;

/// Grace-period window in days. Mirrors platform's `GRACE_PERIOD_DAYS`.
pub const GRACE_PERIOD_DAYS: i64 = 7;

/// Lower-cased tier strings used on the wire. Matches `QuotaTierWire` on
/// the platform side. Serialized as a plain string so the JSON cache is
/// human-readable (and editable in a pinch).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QuotaTier {
    Free,
    Pro,
    Enterprise,
}

impl QuotaTier {
    pub fn is_paid(self) -> bool {
        matches!(self, Self::Pro | Self::Enterprise)
    }
}

/// Quota response shape the platform returns. Mirror of
/// `vskill-platform/src/lib/billing/quota-shape.ts::QuotaResponse`.
///
/// `skillLimit: null` ↔ unlimited (pro/enterprise). On disk we store
/// `Option<i64>` and lift to `null` when serializing — same wire form.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaResponse {
    pub tier: QuotaTier,
    pub skill_count: i64,
    /// `Some(50)` for free; `None` for pro/enterprise.
    pub skill_limit: Option<i64>,
    /// ISO-8601 UTC timestamp of last sync as known to the server. Optional
    /// because the FIRST sync has no prior — server returns `null`.
    pub last_synced_at: Option<String>,
    /// Days the desktop should treat the cache as fresh. Always
    /// `GRACE_PERIOD_DAYS` from the server today; declared for forward-compat.
    pub grace_period_days_remaining: i64,
    /// ISO-8601 UTC server clock at response time — basis for skew correction.
    pub server_now: String,
}

/// Cache shape persisted to `~/.vskill/cache/quota.json`. Wraps the server
/// response with the desktop's clock-skew estimate captured at sync time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuotaCache {
    /// The latest server response, stored verbatim.
    pub response: QuotaResponse,
    /// Local clock at the moment the response was received, ISO-8601 UTC.
    /// Used together with `response.server_now` to compute clock skew.
    pub local_at_sync: String,
    /// Computed delta `local_at_sync - response.server_now` in milliseconds.
    /// Positive when the local clock is ahead of the server.
    pub clock_skew_ms: i64,
}

impl QuotaCache {
    /// Build a cache entry from a fresh quota response and the local clock
    /// at the moment of receipt. `local_now_iso` should be `chrono::Utc::now()
    /// .to_rfc3339()` in production; tests inject a fixed value.
    pub fn from_response(response: QuotaResponse, local_now_iso: String) -> Self {
        let clock_skew_ms =
            compute_skew_ms(&local_now_iso, &response.server_now).unwrap_or(0);
        Self {
            response,
            local_at_sync: local_now_iso,
            clock_skew_ms,
        }
    }

    /// True when the cache is within the grace window relative to the
    /// SERVER's clock at last sync. `local_now_iso` is the current local
    /// clock; we adjust by `clock_skew_ms` so the comparison is server-time.
    ///
    /// Returns false on parse error so a corrupt cache fails closed.
    pub fn is_fresh(&self, local_now_iso: &str) -> bool {
        let server_now_at_sync = match parse_iso_to_ms(&self.response.server_now) {
            Some(v) => v,
            None => return false,
        };
        let local_now = match parse_iso_to_ms(local_now_iso) {
            Some(v) => v,
            None => return false,
        };
        // Subtract the captured skew so we approximate server-time.
        let skew_adjusted_now = local_now.saturating_sub(self.clock_skew_ms);
        let grace_ms = GRACE_PERIOD_DAYS.saturating_mul(86_400_000);
        let fresh_until = server_now_at_sync.saturating_add(grace_ms);
        skew_adjusted_now < fresh_until
    }

    /// Days remaining inside the grace window, computed from server-time.
    /// Returns 0 when stale and a positive number when still fresh. Used
    /// by the QuotaGraceBanner to decide what color to render.
    ///
    /// May return negative numbers for "8d+ overdue" which the UI clamps to
    /// 0 for display but uses to gate hard-stop behavior.
    pub fn days_remaining(&self, local_now_iso: &str) -> i64 {
        let server_now_at_sync = match parse_iso_to_ms(&self.response.server_now) {
            Some(v) => v,
            None => return 0,
        };
        let local_now = match parse_iso_to_ms(local_now_iso) {
            Some(v) => v,
            None => return 0,
        };
        let skew_adjusted_now = local_now.saturating_sub(self.clock_skew_ms);
        let grace_ms = GRACE_PERIOD_DAYS.saturating_mul(86_400_000);
        let fresh_until = server_now_at_sync.saturating_add(grace_ms);
        let diff_ms = fresh_until - skew_adjusted_now;
        diff_ms / 86_400_000
    }
}

/// Errors surfaced by the cache layer.
#[derive(Debug)]
pub enum QuotaCacheError {
    Io(String),
    Parse(String),
}

impl std::fmt::Display for QuotaCacheError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(m) => write!(f, "io: {m}"),
            Self::Parse(m) => write!(f, "parse: {m}"),
        }
    }
}

impl std::error::Error for QuotaCacheError {}

fn cache_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    Some(home.join(".vskill").join("cache").join("quota.json"))
}

/// Persist `cache` to disk. Best-effort — failure is logged at `warn` by the
/// caller; we still have the value in memory for the lifetime of the process.
pub fn save_quota_cache(cache: &QuotaCache) -> Result<(), QuotaCacheError> {
    let path = cache_path().ok_or_else(|| {
        QuotaCacheError::Io("could not resolve $HOME for quota cache".into())
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| QuotaCacheError::Io(format!("mkdir {parent:?}: {e}")))?;
    }
    let json = serde_json::to_string_pretty(cache)
        .map_err(|e| QuotaCacheError::Parse(format!("serialize: {e}")))?;
    std::fs::write(&path, json)
        .map_err(|e| QuotaCacheError::Io(format!("write {path:?}: {e}")))
}

/// Read the disk cache. Returns `Ok(None)` if the file doesn't exist (clean
/// cold-start) — only `Err` for unexpected failures.
pub fn load_quota_cache() -> Result<Option<QuotaCache>, QuotaCacheError> {
    let path = match cache_path() {
        Some(p) => p,
        None => return Ok(None),
    };
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            let parsed: QuotaCache = serde_json::from_str(&text).map_err(|e| {
                QuotaCacheError::Parse(format!("parse quota cache {path:?}: {e}"))
            })?;
            Ok(Some(parsed))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(QuotaCacheError::Io(format!("read {path:?}: {e}"))),
    }
}

/// Remove the cache file. Idempotent — used by sign-out (the next sign-in
/// will start with a clean grace clock).
#[allow(dead_code)]
pub fn clear_quota_cache() -> Result<(), QuotaCacheError> {
    let path = match cache_path() {
        Some(p) => p,
        None => return Ok(()),
    };
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(QuotaCacheError::Io(format!("remove {path:?}: {e}"))),
    }
}

// ---------------------------------------------------------------------------
// ISO-8601 parsing — minimal RFC 3339 parser.
//
// We avoid pulling `chrono` just to parse two timestamps: it's ~600KB of
// release binary impact for one rarely-hot code path. The parser handles
// the canonical `YYYY-MM-DDTHH:MM:SS[.fff]Z` form which is what the platform
// emits via JS `Date.toISOString()` and what Rust crates emit via
// `time::OffsetDateTime::format(&Rfc3339)`. Returns milliseconds since
// epoch; `None` for any malformed input.
// ---------------------------------------------------------------------------

fn parse_iso_to_ms(s: &str) -> Option<i64> {
    // Accept `2026-05-07T12:00:00Z` and `2026-05-07T12:00:00.123Z` and
    // `2026-05-07T12:00:00+00:00`. Reject anything else conservatively.
    // Per RFC 3339 section 5.6 the date and time parts are dash/colon
    // separated and the time-offset is mandatory.
    let bytes = s.as_bytes();
    if bytes.len() < 20 {
        return None;
    }
    // Date: "YYYY-MM-DD"
    let year: i64 = s.get(0..4)?.parse().ok()?;
    if bytes[4] != b'-' {
        return None;
    }
    let month: u32 = s.get(5..7)?.parse().ok()?;
    if bytes[7] != b'-' {
        return None;
    }
    let day: u32 = s.get(8..10)?.parse().ok()?;
    // Separator: 'T' (canonical) or ' ' (loose, also accepted).
    if bytes[10] != b'T' && bytes[10] != b' ' {
        return None;
    }
    // Time: "HH:MM:SS"
    let hour: u32 = s.get(11..13)?.parse().ok()?;
    if bytes[13] != b':' {
        return None;
    }
    let minute: u32 = s.get(14..16)?.parse().ok()?;
    if bytes[16] != b':' {
        return None;
    }
    let second: u32 = s.get(17..19)?.parse().ok()?;
    // Optional fractional seconds. Skip past them — they don't add precision
    // to our day-granularity comparison, but we still need to reach the
    // timezone marker.
    let mut idx = 19usize;
    let mut frac_ms: u32 = 0;
    if bytes.get(idx) == Some(&b'.') {
        idx += 1;
        let frac_start = idx;
        while idx < bytes.len() && bytes[idx].is_ascii_digit() {
            idx += 1;
        }
        let frac_str = s.get(frac_start..idx)?;
        // Pad/truncate to exactly 3 digits = milliseconds.
        let mut padded = String::with_capacity(3);
        for c in frac_str.chars().chain(std::iter::repeat('0')).take(3) {
            padded.push(c);
        }
        frac_ms = padded.parse().ok()?;
    }
    // Timezone — we accept Z (UTC) and ±HH:MM offsets.
    let tz_offset_ms: i64 = match bytes.get(idx) {
        Some(&b'Z') => 0,
        Some(&b'+') | Some(&b'-') => {
            let sign: i64 = if bytes[idx] == b'+' { 1 } else { -1 };
            let hh: i64 = s.get(idx + 1..idx + 3)?.parse().ok()?;
            // Some emitters omit the colon (`+0000`); accept both.
            let mm_start = if bytes.get(idx + 3) == Some(&b':') {
                idx + 4
            } else {
                idx + 3
            };
            let mm: i64 = s.get(mm_start..mm_start + 2)?.parse().ok()?;
            sign * (hh * 3600 + mm * 60) * 1000
        }
        _ => return None,
    };

    // Days-from-civil algorithm (Howard Hinnant) to convert (Y,M,D) to
    // a serial day count without dragging in a date library. Unix epoch
    // is day 0 = 1970-01-01.
    let y = year - if month <= 2 { 1 } else { 0 };
    let era: i64 = if y >= 0 { y } else { y - 399 } / 400;
    let yoe: i64 = y - era * 400; // [0, 399]
    let m = month as i64;
    let d = day as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days_since_epoch = era * 146097 + doe - 719468;

    let secs_of_day: i64 = (hour as i64) * 3600 + (minute as i64) * 60 + (second as i64);
    let total_ms = days_since_epoch
        .checked_mul(86_400_000)?
        .checked_add(secs_of_day * 1000)?
        .checked_add(frac_ms as i64)?
        .checked_sub(tz_offset_ms)?;
    Some(total_ms)
}

fn compute_skew_ms(local_now_iso: &str, server_now_iso: &str) -> Option<i64> {
    let local = parse_iso_to_ms(local_now_iso)?;
    let server = parse_iso_to_ms(server_now_iso)?;
    Some(local - server)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_response(server_now: &str) -> QuotaResponse {
        QuotaResponse {
            tier: QuotaTier::Free,
            skill_count: 47,
            skill_limit: Some(50),
            last_synced_at: None,
            grace_period_days_remaining: GRACE_PERIOD_DAYS,
            server_now: server_now.to_string(),
        }
    }

    #[test]
    fn parse_iso_handles_z_form() {
        // 2026-05-08T00:00:00Z = 20581 days * 86400 * 1000 ms.
        // (20581 = 20454 [2026-01-01] + 127 [Jan 31 + Feb 28 + Mar 31 + Apr 30 + 7]).
        let v = parse_iso_to_ms("2026-05-08T00:00:00Z").expect("parse");
        assert_eq!(v, 20581_i64 * 86_400_000);
    }

    #[test]
    fn parse_iso_handles_offset_form() {
        // 12:00 UTC == 13:00+01:00 — same instant.
        let z = parse_iso_to_ms("2026-05-07T12:00:00Z").expect("z");
        let off = parse_iso_to_ms("2026-05-07T13:00:00+01:00").expect("off");
        assert_eq!(z, off);
    }

    #[test]
    fn parse_iso_handles_fractional_seconds() {
        let a = parse_iso_to_ms("2026-05-07T12:00:00Z").expect("a");
        let b = parse_iso_to_ms("2026-05-07T12:00:00.500Z").expect("b");
        assert_eq!(b - a, 500);
    }

    #[test]
    fn parse_iso_rejects_garbage() {
        assert_eq!(parse_iso_to_ms(""), None);
        assert_eq!(parse_iso_to_ms("not a date"), None);
        assert_eq!(parse_iso_to_ms("garbage-with-right-len"), None);
        // Numerically-malformed month falls through the parser but yields a
        // nonsense value — that's tolerated for this minimal parser; we only
        // need to handle well-formed RFC 3339 emitted by Date.toISOString().
    }

    #[test]
    fn cache_is_fresh_inside_grace_window() {
        let cache = QuotaCache::from_response(
            sample_response("2026-05-01T00:00:00Z"),
            "2026-05-01T00:00:01Z".to_string(),
        );
        // 6 days later — inside 7-day window.
        assert!(cache.is_fresh("2026-05-07T00:00:00Z"));
        // 1 day later — definitely inside.
        assert!(cache.is_fresh("2026-05-02T00:00:00Z"));
    }

    #[test]
    fn cache_is_stale_after_grace_window() {
        let cache = QuotaCache::from_response(
            sample_response("2026-05-01T00:00:00Z"),
            "2026-05-01T00:00:01Z".to_string(),
        );
        // 8 days later — outside 7-day window.
        assert!(!cache.is_fresh("2026-05-09T00:00:00Z"));
    }

    #[test]
    fn cache_freshness_uses_server_clock_not_local() {
        // Local clock 1 hour ahead of server at sync time.
        let cache = QuotaCache::from_response(
            sample_response("2026-05-01T00:00:00Z"),
            "2026-05-01T01:00:00Z".to_string(),
        );
        // skew_ms should be +3_600_000 (local ahead).
        assert_eq!(cache.clock_skew_ms, 3_600_000);
        // 7 days later in LOCAL time = 7 days less 1h in SERVER time → still fresh.
        assert!(cache.is_fresh("2026-05-08T00:30:00Z"));
        // 7 days + 1h later in LOCAL time = exactly 7 days in SERVER time → stale.
        assert!(!cache.is_fresh("2026-05-08T01:30:00Z"));
    }

    #[test]
    fn days_remaining_counts_down() {
        let cache = QuotaCache::from_response(
            sample_response("2026-05-01T00:00:00Z"),
            "2026-05-01T00:00:00Z".to_string(),
        );
        assert_eq!(cache.days_remaining("2026-05-01T00:00:00Z"), 7);
        assert_eq!(cache.days_remaining("2026-05-04T00:00:00Z"), 4);
        assert_eq!(cache.days_remaining("2026-05-08T00:00:00Z"), 0);
        // 2 days overdue → -2.
        assert_eq!(cache.days_remaining("2026-05-10T00:00:00Z"), -2);
    }

    #[test]
    fn quota_response_matches_wire_shape() {
        // The wire JSON the platform emits MUST round-trip through our type.
        // This snapshot is the contract — bump intentionally if the platform
        // adds fields.
        let json = r#"{
            "tier": "free",
            "skillCount": 47,
            "skillLimit": 50,
            "lastSyncedAt": "2026-05-07T12:00:00Z",
            "gracePeriodDaysRemaining": 7,
            "serverNow": "2026-05-07T13:00:00Z"
        }"#;
        let parsed: QuotaResponse = serde_json::from_str(json).expect("parse");
        assert_eq!(parsed.tier, QuotaTier::Free);
        assert_eq!(parsed.skill_count, 47);
        assert_eq!(parsed.skill_limit, Some(50));
        assert_eq!(parsed.grace_period_days_remaining, 7);
    }

    #[test]
    fn pro_tier_skill_limit_is_null() {
        let json = r#"{
            "tier": "pro",
            "skillCount": 999,
            "skillLimit": null,
            "lastSyncedAt": null,
            "gracePeriodDaysRemaining": 7,
            "serverNow": "2026-05-07T13:00:00Z"
        }"#;
        let parsed: QuotaResponse = serde_json::from_str(json).expect("parse");
        assert_eq!(parsed.tier, QuotaTier::Pro);
        assert!(parsed.tier.is_paid());
        assert_eq!(parsed.skill_limit, None);
    }

    #[test]
    fn enterprise_tier_recognized() {
        let json = r#"{"tier":"enterprise","skillCount":1,"skillLimit":null,"lastSyncedAt":null,"gracePeriodDaysRemaining":7,"serverNow":"2026-05-07T13:00:00Z"}"#;
        let parsed: QuotaResponse = serde_json::from_str(json).expect("parse");
        assert_eq!(parsed.tier, QuotaTier::Enterprise);
        assert!(parsed.tier.is_paid());
    }
}
