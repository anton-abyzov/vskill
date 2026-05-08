// 0831 folders — classifier: ordered ruleset for folder-pick disambiguation.
//
// Implements ADR-0831-03 (Folder picker classification rules):
//
//   1. `home_root`      — path equals `$HOME` exactly
//   2. `personal_scope` — path matches any of the AI-tooling personal-scope
//                          dirs (`~/.claude/`, `~/.claude-plugin/`,
//                          `~/.specweave/`, `~/.codex/`, `~/.cursor/`,
//                          `~/.copilot/`, `~/.gemini/`) OR ends in
//                          `/.claude/skills` at any depth
//   3. `project_root` (strong) — `.git/` AND `git remote get-url origin`
//                                 succeeds → returns `has_git: true` +
//                                 the remote URL
//   4. `project_root` (weak)   — has `.specweave/` OR `package.json` OR
//                                 `Cargo.toml`
//   5. else                    — `Unclassified`
//
// Order matters: rules are checked top-down and the first match wins. This
// is the boundary-case nuance of the ADR — `~/.claude/skills/foo` IS a
// PersonalScope match even though that directory could in theory contain
// a `.git/` (PersonalScope wins over the project-root rules). Likewise
// `$HOME` itself with a `.git/` inside (some people version their dotfiles)
// is classified as `HomeRoot` and NOT `ProjectRoot` — the warning modal
// still fires so the user can confirm intent.
//
// The classifier is **pure-logic** by design: filesystem probes are
// abstracted behind the `FsProbe` trait so tests can inject deterministic
// answers without touching the real disk. Production code uses
// `RealFsProbe` which wraps `std::fs` + `std::process::Command` for git.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Classification outcome for a chosen folder path.
///
/// `ProjectRoot` carries metadata about the strength of the signal so the
/// caller can render a sync-state widget for strong matches and a neutral
/// "blank project" hint for weak matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FolderClassification {
    /// Path equals `$HOME` exactly. Triggers the warning modal.
    HomeRoot,
    /// Path is under a known AI-tooling personal-scope directory (or ends
    /// in `/.claude/skills` at any depth). Studio shows personal skills,
    /// not project skills — no `git remote` probe.
    PersonalScope,
    /// Folder is a project root. `has_git=true` plus a `remote_url` means
    /// it's a strong-signal project (we can connect the GitHub widget).
    /// `has_git=false` means we found a weak signal (manifest file).
    ProjectRoot {
        has_git: bool,
        remote_url: Option<String>,
    },
    /// None of the above rules matched. The studio still proceeds — the
    /// warning modal does NOT fire for this case. It's a valid "fresh new
    /// folder" state.
    Unclassified,
}

/// Filesystem probe surface — abstracted so unit tests don't touch disk.
///
/// All four methods return cheap booleans / Option<String>. The classifier
/// composes them; it never reads file contents itself.
pub trait FsProbe {
    /// Does the path exist AND is it a directory?
    fn is_dir(&self, path: &Path) -> bool;
    /// Does `path/<child>` exist?
    fn child_exists(&self, path: &Path, child: &str) -> bool;
    /// Try `git -C <path> remote get-url origin`. Returns the URL or None.
    fn git_remote_origin(&self, path: &Path) -> Option<String>;
    /// What is `$HOME`? Wrapped so tests can fake it.
    fn home_dir(&self) -> Option<PathBuf>;
}

/// Production probe: `std::fs` + `std::process::Command`.
pub struct RealFsProbe;

impl FsProbe for RealFsProbe {
    fn is_dir(&self, path: &Path) -> bool {
        path.is_dir()
    }
    fn child_exists(&self, path: &Path, child: &str) -> bool {
        path.join(child).exists()
    }
    fn git_remote_origin(&self, path: &Path) -> Option<String> {
        // Delegate to `super::git_remote` so the binary doesn't ship two
        // copies of the git-shellout logic.
        super::git_remote::raw_remote_url(path)
    }
    fn home_dir(&self) -> Option<PathBuf> {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Personal-scope directory roots (relative to `$HOME`). Order doesn't
/// matter — a path matches if it equals OR is under any of these.
///
/// NOTE: these are the *prefixes* the ADR enumerates explicitly. The
/// `/.claude/skills` (any depth) rule is handled separately because it
/// can appear nested inside a project repo (e.g.
/// `~/projects/my-app/.claude/skills/foo`) and must classify as
/// PersonalScope per the agent task brief boundary case.
const PERSONAL_SCOPE_HOME_DIRS: &[&str] = &[
    ".claude",
    ".claude-plugin",
    ".specweave",
    ".codex",
    ".cursor",
    ".copilot",
    ".gemini",
];

/// Classify a folder path according to ADR-0831-03.
///
/// `path` is normalized via `Path::components()` for prefix comparison —
/// we deliberately do NOT call `canonicalize()` because that would resolve
/// symlinks, which surprises users who pick `/Users/foo/Projects` (often
/// a symlink to `/Volumes/Data/Projects`) and would see the warning fire
/// or not based on hidden disk topology. Path-equality is by component
/// chain only.
pub fn classify<P: FsProbe>(path: &Path, probe: &P) -> FolderClassification {
    // Rule 0 (gate): non-existent or non-directory paths are not
    // classifiable. The IPC layer surfaces this as an inline error, NOT a
    // FolderClassification variant — Unclassified is for *valid but
    // unmatched* directories. Callers (the IPC) check `is_dir` first;
    // here we trust the probe to short-circuit if needed.
    if !probe.is_dir(path) {
        // Defensive: if probe says not-a-dir we still return Unclassified
        // so the surface stays a single enum. The IPC layer's separate
        // existence check is the canonical place to surface AC-US3-06.
        return FolderClassification::Unclassified;
    }

    let home = probe.home_dir();

    // Rule 1: home_root — path EQUALS $HOME exactly.
    if let Some(h) = &home {
        if path == h.as_path() {
            return FolderClassification::HomeRoot;
        }
    }

    // Rule 2: personal_scope.
    if matches_personal_scope(path, home.as_deref()) {
        return FolderClassification::PersonalScope;
    }

    // Rule 3: project_root (strong) — .git/ AND git remote get-url succeeds.
    let has_git = probe.child_exists(path, ".git");
    if has_git {
        if let Some(remote) = probe.git_remote_origin(path) {
            return FolderClassification::ProjectRoot {
                has_git: true,
                remote_url: Some(remote),
            };
        }
        // .git/ exists but no remote — fall through to weak signal
        // collection below, so we still classify as ProjectRoot but
        // without a remote_url. Without `Cargo.toml`/`package.json`/etc.
        // the user gets `has_git: true, remote_url: None`.
        return FolderClassification::ProjectRoot {
            has_git: true,
            remote_url: None,
        };
    }

    // Rule 4: project_root (weak) — .specweave/ OR package.json OR Cargo.toml.
    let has_specweave = probe.child_exists(path, ".specweave");
    let has_package_json = probe.child_exists(path, "package.json");
    let has_cargo_toml = probe.child_exists(path, "Cargo.toml");
    if has_specweave || has_package_json || has_cargo_toml {
        return FolderClassification::ProjectRoot {
            has_git: false,
            remote_url: None,
        };
    }

    // Rule 5: nothing matched.
    FolderClassification::Unclassified
}

/// Returns true if `path` is under any of the personal-scope home dirs OR
/// matches the `**/.claude/skills` (any depth) wildcard rule.
fn matches_personal_scope(path: &Path, home: Option<&Path>) -> bool {
    // Rule 2a: prefix-match against the explicit `~/.X` directory list.
    if let Some(h) = home {
        for dir in PERSONAL_SCOPE_HOME_DIRS {
            let prefix = h.join(dir);
            if path == prefix.as_path() || path.starts_with(&prefix) {
                return true;
            }
        }
    }

    // Rule 2b: any path ending in `.claude/skills` (any depth).
    // We walk components and look for the pair `.claude/skills` as a
    // suffix. This catches:
    //   ~/.claude/skills                 (already matched by 2a actually)
    //   ~/projects/repo/.claude/skills   (project-local skills dir)
    //   /tmp/foo/.claude/skills/sub      (nested skill dir)
    // For the third case we want PersonalScope to win over any project
    // signals because the skills under that dir ARE personal-scope by
    // schema, regardless of where on disk they live.
    let comps: Vec<&std::ffi::OsStr> = path.components().map(|c| c.as_os_str()).collect();
    for window in comps.windows(2) {
        if window[0] == ".claude" && window[1] == "skills" {
            return true;
        }
    }
    false
}

// ---------------------------------------------------------------------------
// Tests — 17 unit cases covering ADR-0831-03 ordered ruleset + boundaries.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Test-only probe that lets each test pin down the answer for every
    /// FsProbe method without touching disk. Construct with the home dir
    /// the test wants, then mark whichever children exist via setters.
    struct FakeProbe {
        home: Option<PathBuf>,
        // (path, child) pairs that should report exists.
        existing_children: HashSet<(PathBuf, String)>,
        // dirs that should report is_dir=true.
        dirs: HashSet<PathBuf>,
        // (path, url) — what git_remote_origin returns for a given path.
        remotes: std::collections::HashMap<PathBuf, String>,
    }

    impl FakeProbe {
        fn new(home: Option<&str>) -> Self {
            Self {
                home: home.map(PathBuf::from),
                existing_children: HashSet::new(),
                dirs: HashSet::new(),
                remotes: std::collections::HashMap::new(),
            }
        }
        fn with_dir(mut self, p: &str) -> Self {
            self.dirs.insert(PathBuf::from(p));
            self
        }
        fn with_child(mut self, p: &str, child: &str) -> Self {
            self.existing_children
                .insert((PathBuf::from(p), child.to_string()));
            self
        }
        fn with_remote(mut self, p: &str, url: &str) -> Self {
            self.remotes.insert(PathBuf::from(p), url.to_string());
            self
        }
    }

    impl FsProbe for FakeProbe {
        fn is_dir(&self, path: &Path) -> bool {
            self.dirs.contains(path)
        }
        fn child_exists(&self, path: &Path, child: &str) -> bool {
            self.existing_children
                .contains(&(path.to_path_buf(), child.to_string()))
        }
        fn git_remote_origin(&self, path: &Path) -> Option<String> {
            self.remotes.get(path).cloned()
        }
        fn home_dir(&self) -> Option<PathBuf> {
            self.home.clone()
        }
    }

    // Rule 1 ----------------------------------------------------------------

    #[test]
    fn home_dir_classifies_as_home_root() {
        let probe = FakeProbe::new(Some("/Users/maria")).with_dir("/Users/maria");
        let result = classify(Path::new("/Users/maria"), &probe);
        assert_eq!(result, FolderClassification::HomeRoot);
    }

    #[test]
    fn home_with_git_subdir_still_classifies_as_home_root() {
        // Boundary case from agent task brief: "home with .git = still HomeRoot".
        // Some users version their dotfiles directly under $HOME — we still
        // warn them rather than silently treating $HOME as a project repo.
        let probe = FakeProbe::new(Some("/Users/maria"))
            .with_dir("/Users/maria")
            .with_child("/Users/maria", ".git")
            .with_remote("/Users/maria", "git@github.com:maria/dotfiles.git");
        let result = classify(Path::new("/Users/maria"), &probe);
        assert_eq!(result, FolderClassification::HomeRoot);
    }

    // Rule 2 ----------------------------------------------------------------

    #[test]
    fn dot_claude_under_home_is_personal_scope() {
        let probe = FakeProbe::new(Some("/Users/maria")).with_dir("/Users/maria/.claude");
        let result = classify(Path::new("/Users/maria/.claude"), &probe);
        assert_eq!(result, FolderClassification::PersonalScope);
    }

    #[test]
    fn dot_claude_skills_subdir_is_personal_scope() {
        let probe =
            FakeProbe::new(Some("/Users/maria")).with_dir("/Users/maria/.claude/skills/foo");
        let result = classify(Path::new("/Users/maria/.claude/skills/foo"), &probe);
        assert_eq!(result, FolderClassification::PersonalScope);
    }

    #[test]
    fn project_local_dot_claude_skills_is_personal_scope() {
        // Boundary case from agent task brief: "~/.claude/skills/foo =
        // PersonalScope" but ALSO any path ending in `.claude/skills` even
        // if it's nested deep inside a project tree. Rationale: skills under
        // such a dir are personal-scope by schema regardless of where they
        // physically live.
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/app/.claude/skills");
        let result = classify(
            Path::new("/Users/devon/projects/app/.claude/skills"),
            &probe,
        );
        assert_eq!(result, FolderClassification::PersonalScope);
    }

    #[test]
    fn dot_specweave_under_home_is_personal_scope() {
        // `~/.specweave/` is in the explicit personal-scope list per the
        // agent task brief. (Not to be confused with project-local
        // `<repo>/.specweave/` which classifies as ProjectRoot weak via
        // child_exists check on Rule 4.)
        let probe = FakeProbe::new(Some("/Users/maria")).with_dir("/Users/maria/.specweave");
        let result = classify(Path::new("/Users/maria/.specweave"), &probe);
        assert_eq!(result, FolderClassification::PersonalScope);
    }

    #[test]
    fn dot_codex_cursor_copilot_gemini_all_personal_scope() {
        // Iterate the four other AI-tooling dirs; assert each classifies
        // PersonalScope. A regression here means the constant table got
        // de-synced from the spec.
        for dir in [".codex", ".cursor", ".copilot", ".gemini", ".claude-plugin"] {
            let p = format!("/Users/maria/{dir}");
            let probe = FakeProbe::new(Some("/Users/maria")).with_dir(&p);
            let result = classify(Path::new(&p), &probe);
            assert_eq!(
                result,
                FolderClassification::PersonalScope,
                "expected {dir} to classify as PersonalScope"
            );
        }
    }

    #[test]
    fn dot_claude_agents_skills_is_personal_scope() {
        // AC-US3-03 explicitly calls out `~/.claude/agents/skills/` as a
        // personal-scope path the studio must label as such. Covered by the
        // generic `~/.claude/` prefix-match in Rule 2a, but the spec lists
        // this exact path so we pin it down with a dedicated test in case
        // the prefix list gets pruned later.
        let probe = FakeProbe::new(Some("/Users/maria"))
            .with_dir("/Users/maria/.claude/agents/skills");
        let result = classify(
            Path::new("/Users/maria/.claude/agents/skills"),
            &probe,
        );
        assert_eq!(result, FolderClassification::PersonalScope);
    }

    // Rule 3 ----------------------------------------------------------------

    #[test]
    fn git_repo_with_github_remote_is_project_root_strong() {
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/app")
            .with_child("/Users/devon/projects/app", ".git")
            .with_remote(
                "/Users/devon/projects/app",
                "git@github.com:devon/app.git",
            );
        let result = classify(Path::new("/Users/devon/projects/app"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: true,
                remote_url: Some("git@github.com:devon/app.git".into()),
            }
        );
    }

    #[test]
    fn git_repo_without_remote_is_project_root_no_url() {
        // .git/ exists but `git remote get-url origin` fails (no remote
        // configured). Per the design, this still classifies as
        // ProjectRoot (the user clearly intends a project — they have a
        // .git/) but without a remote_url so the connected-repo widget
        // shows "Local-only (no remote)".
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/local")
            .with_child("/Users/devon/projects/local", ".git");
        let result = classify(Path::new("/Users/devon/projects/local"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: true,
                remote_url: None,
            }
        );
    }

    // Rule 4 ----------------------------------------------------------------

    #[test]
    fn weak_signal_specweave_only_is_project_root_weak() {
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/specs")
            .with_child("/Users/devon/projects/specs", ".specweave");
        let result = classify(Path::new("/Users/devon/projects/specs"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: false,
                remote_url: None,
            }
        );
    }

    #[test]
    fn weak_signal_package_json_only_is_project_root_weak() {
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/node-app")
            .with_child("/Users/devon/projects/node-app", "package.json");
        let result = classify(Path::new("/Users/devon/projects/node-app"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: false,
                remote_url: None,
            }
        );
    }

    #[test]
    fn weak_signal_cargo_toml_only_is_project_root_weak() {
        let probe = FakeProbe::new(Some("/Users/devon"))
            .with_dir("/Users/devon/projects/rust-app")
            .with_child("/Users/devon/projects/rust-app", "Cargo.toml");
        let result = classify(Path::new("/Users/devon/projects/rust-app"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: false,
                remote_url: None,
            }
        );
    }

    // Rule 5 ----------------------------------------------------------------

    #[test]
    fn empty_dir_with_no_signals_is_unclassified() {
        // An empty new folder under ~/Documents — no .git, no manifest,
        // not under a personal-scope dir, not equal to $HOME. The user
        // proceeds without warning per ADR-0831-03 rule 5.
        let probe = FakeProbe::new(Some("/Users/maria")).with_dir("/Users/maria/Documents/new");
        let result = classify(Path::new("/Users/maria/Documents/new"), &probe);
        assert_eq!(result, FolderClassification::Unclassified);
    }

    // Boundary / robustness ------------------------------------------------

    #[test]
    fn non_existent_path_returns_unclassified_defensively() {
        // The IPC layer is the canonical place to surface
        // "does-not-exist" as an inline error (AC-US3-06). The classifier
        // itself returns Unclassified rather than panicking, so callers
        // who skip the existence check don't crash the app.
        let probe = FakeProbe::new(Some("/Users/maria"));
        // No `.with_dir(...)` — is_dir returns false.
        let result = classify(Path::new("/Users/maria/Documents/missing"), &probe);
        assert_eq!(result, FolderClassification::Unclassified);
    }

    #[test]
    fn missing_home_dir_skips_rules_1_and_2() {
        // If $HOME is unset (rare but possible in test runners or
        // sandboxed Tauri contexts), rules 1 and 2 short-circuit and we
        // fall through to the project-root rules. A repo with .git/
        // should still classify correctly.
        let probe = FakeProbe::new(None)
            .with_dir("/projects/app")
            .with_child("/projects/app", ".git")
            .with_remote("/projects/app", "https://github.com/foo/bar");
        let result = classify(Path::new("/projects/app"), &probe);
        assert_eq!(
            result,
            FolderClassification::ProjectRoot {
                has_git: true,
                remote_url: Some("https://github.com/foo/bar".into()),
            }
        );
    }

    #[test]
    fn personal_scope_wins_over_project_signals() {
        // If a folder is BOTH under `~/.claude/` AND has `.git/` (rare —
        // someone versioning their personal-scope skills via git), we
        // honor the personal-scope rule per ADR-0831-03's rule order.
        // Without this, picking `~/.claude/skills/my-versioned-set` would
        // try to connect a GitHub widget for it, which is wrong UX.
        let probe = FakeProbe::new(Some("/Users/maria"))
            .with_dir("/Users/maria/.claude/skills/versioned")
            .with_child("/Users/maria/.claude/skills/versioned", ".git")
            .with_remote(
                "/Users/maria/.claude/skills/versioned",
                "git@github.com:maria/skills.git",
            );
        let result = classify(Path::new("/Users/maria/.claude/skills/versioned"), &probe);
        assert_eq!(result, FolderClassification::PersonalScope);
    }
}
