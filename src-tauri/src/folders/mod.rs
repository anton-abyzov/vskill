// 0831 folders — folder picker classifier + git remote/sync detection.
//
// Module owned by desktop-folder-agent (impl-0831-enterprise team).
//
//   - classifier  : ADR-0831-03 ordered ruleset (HomeRoot / PersonalScope /
//                    ProjectRoot / Unclassified). Pure-logic, FsProbe trait
//                    abstracts disk for unit testability.
//   - git_remote  : `git remote get-url origin` parser (HTTPS + SSH forms),
//                    `git status` + `rev-list` sync-state probe.
//
// Both are consumed by:
//   - `commands::pick_default_project_folder` (extended in T-013) to attach
//     a `FolderClassification` to the picked path.
//   - `commands::get_repo_info` (T-016) to power the ConnectedRepoWidget.

pub mod classifier;
pub mod git_remote;

// Re-exports keep IPC handler imports short. Marked `allow(unused_imports)`
// because some types (RealFsProbe, SyncState) are part of the module's
// public Rust API for downstream agents but not all are consumed by the
// IPC layer in the current PR.
#[allow(unused_imports)]
pub use classifier::{classify, FolderClassification, FsProbe, RealFsProbe};
#[allow(unused_imports)]
pub use git_remote::{detect_remote, detect_sync_state, parse_github_url, RemoteInfo, SyncState};
