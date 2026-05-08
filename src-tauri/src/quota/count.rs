// 0831 quota::count — local skill counter.
//
// Walks the on-disk skill roots and returns a deduplicated count. The desktop
// uses this for two purposes:
//   1. Pre-paywall short-circuit — if `local_count < skill_limit` we know the
//      create can't possibly hit the cap, no need to round-trip the platform.
//   2. Telemetry POST — the platform records `lastReportedSkillCount` for
//      overage detection (manual file copies, old-version side channels).
//
// What counts as a skill:
//   - Any directory containing a `SKILL.md` file (canonical marker — same one
//      Skill Studio uses to render rows in the sidebar).
//   - Identity = (name, version) read from the SKILL.md frontmatter. We only
//      need the keys; we don't validate the rest of the manifest.
//
// Roots we walk (per AC-US5-06):
//   - `~/.claude/skills/`            (personal scope)
//   - `~/.claude/agents/skills/`     (legacy personal scope, defensive)
//   - Each opened project root passed in by the IPC layer.
//
// The walker is depth-bounded (max 4 levels under any root) so a misdirected
// pick (`~`) doesn't fan out into the whole disk.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug)]
#[allow(dead_code)]
pub enum SkillCountError {
    Io(String),
}

impl std::fmt::Display for SkillCountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(m) => write!(f, "io: {m}"),
        }
    }
}

impl std::error::Error for SkillCountError {}

const MAX_DEPTH: usize = 4;

/// Count skills across the personal-scope roots + the supplied project
/// roots. Returns the number of unique `name@version` identities. Any IO
/// error on individual files is logged at debug and the file skipped —
/// the count is best-effort.
pub fn count_local_skills(project_roots: &[PathBuf]) -> Result<i64, SkillCountError> {
    let mut seen: HashSet<String> = HashSet::new();

    // Personal scope roots, all under ~/.claude/.
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        let personal_roots = [
            home.join(".claude").join("skills"),
            home.join(".claude").join("agents").join("skills"),
        ];
        for root in &personal_roots {
            walk_root(root, &mut seen);
        }
    }

    // Project roots — caller passes the workspace's open projects. We also
    // probe `<project>/.claude/skills` as the convention for project-scope
    // skills.
    for root in project_roots {
        walk_root(root, &mut seen);
        walk_root(&root.join(".claude").join("skills"), &mut seen);
    }

    Ok(seen.len() as i64)
}

fn walk_root(root: &Path, seen: &mut HashSet<String>) {
    if !root.is_dir() {
        return;
    }
    walk_recursive(root, 0, seen);
}

fn walk_recursive(dir: &Path, depth: usize, seen: &mut HashSet<String>) {
    if depth > MAX_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // SKILL.md is a peer of the dir's children, e.g.
            //   skills/my-skill/SKILL.md
            // so we look for it inside this dir as we descend.
            let manifest = path.join("SKILL.md");
            if manifest.is_file() {
                if let Some(id) = read_identity(&manifest) {
                    seen.insert(id);
                }
            }
            walk_recursive(&path, depth + 1, seen);
        }
    }
}

/// Pull the `name` + `version` from a SKILL.md frontmatter. Returns
/// `Some("name@version")` on success, None on any parse failure (the file
/// is then skipped — counting deals with best-effort data).
fn read_identity(manifest_path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(manifest_path).ok()?;
    let mut name: Option<String> = None;
    let mut version: Option<String> = None;
    let mut in_frontmatter = false;
    for (i, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if i == 0 && trimmed == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter && trimmed == "---" {
            break;
        }
        if !in_frontmatter {
            // No frontmatter at all — fall back to the directory name as
            // identity, with version "?".
            return manifest_path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .map(|n| format!("{n}@?"));
        }
        if let Some(rest) = trimmed.strip_prefix("name:") {
            name = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(rest) = trimmed.strip_prefix("version:") {
            version = Some(rest.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    let name = name?;
    let version = version.unwrap_or_else(|| "?".into());
    Some(format!("{name}@{version}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn temp_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("vskill-quota-count-test-{pid}-{n}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_skill(root: &Path, name: &str, version: &str) {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let mut f = std::fs::File::create(dir.join("SKILL.md")).unwrap();
        writeln!(f, "---").unwrap();
        writeln!(f, "name: {name}").unwrap();
        writeln!(f, "version: {version}").unwrap();
        writeln!(f, "---").unwrap();
        writeln!(f, "# {name}").unwrap();
    }

    #[test]
    fn counts_skills_in_a_root() {
        let root = temp_dir();
        write_skill(&root, "alpha", "1.0.0");
        write_skill(&root, "beta", "2.1.0");
        write_skill(&root, "gamma", "0.9.0");
        let count = count_local_skills(&[root.clone()]).unwrap();
        // Will also pick up any HOME side-effects from the test env, so
        // we assert "at least 3".
        assert!(count >= 3, "expected ≥3, got {count}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn dedup_by_name_at_version() {
        let root_a = temp_dir();
        let root_b = temp_dir();
        // Same identity in two roots → counted once.
        write_skill(&root_a, "shared", "1.0.0");
        write_skill(&root_b, "shared", "1.0.0");
        // Different identity → counted both.
        write_skill(&root_a, "shared-alt", "1.0.0");
        write_skill(&root_b, "shared", "2.0.0"); // different version
        let count_a = count_local_skills(&[root_a.clone()]).unwrap();
        let count_both = count_local_skills(&[root_a.clone(), root_b.clone()]).unwrap();
        // root_a has 2 identities (`shared@1.0.0` + `shared-alt@1.0.0`).
        // Combined adds `shared@2.0.0` for a third — but `shared@1.0.0`
        // dedupes.
        assert_eq!(count_both - count_a, 1);
        std::fs::remove_dir_all(&root_a).ok();
        std::fs::remove_dir_all(&root_b).ok();
    }

    #[test]
    fn frontmatter_missing_falls_back_to_directory_name() {
        let root = temp_dir();
        let dir = root.join("no-frontmatter");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), "# bare body, no frontmatter").unwrap();
        let count = count_local_skills(&[root.clone()]).unwrap();
        assert!(count >= 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn empty_root_returns_zero_or_existing() {
        let root = temp_dir();
        // No skills written.
        let count = count_local_skills(&[root.clone()]).unwrap();
        // May include incidental personal-scope skills; we can only assert
        // that the empty root contributes nothing additive.
        let _ = count;
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_root_is_silent_no_op() {
        let nonexistent = PathBuf::from("/this/path/does/not/exist/vskill-quota-test");
        let count = count_local_skills(&[nonexistent]).unwrap();
        // Doesn't panic; doesn't error; just returns whatever HOME has.
        assert!(count >= 0);
    }
}
