// ---------------------------------------------------------------------------
// 0743: shared lockfile-entry builder for GitHub-sourced installs.
//
// Both the direct-repo install path and the single-skill legacy install
// path in `add.ts` build a `SkillLockEntry` with the same shape. Centralising
// the construction here ensures both paths persist `sourceRepoUrl` and
// `sourceSkillPath` consistently — the missing fields were the root cause
// of the studio anchor 404s for skills installed from multi-skill repos.
// ---------------------------------------------------------------------------
import type { SkillLockEntry } from "../lockfile/types.js";

export interface BuildGitHubInstallLockEntryArgs {
  /** Resolved skill version (frontmatter `version:` or "1.0.0" fallback). */
  version: string;
  /** SHA of the SKILL.md content (for ghost-file detection on update). */
  sha: string;
  /** GitHub owner (e.g. "anton-abyzov"). */
  owner: string;
  /** GitHub repo (e.g. "vskill"). */
  repo: string;
  /**
   * Repo-relative path to the skill's SKILL.md (e.g.
   * "plugins/sw/skills/greet-anton/SKILL.md", or "SKILL.md" for root).
   *
   * Pass `null` only when the path is genuinely unknown — the studio will
   * then fall back to the local-path copy-chip instead of synthesising a
   * (likely-wrong) GitHub blob URL.
   */
  sourceSkillPath: string | null;
  /** Branch/ref used when installing from GitHub. */
  branch?: string | null;
  /** Commit SHA at install time. */
  commitSha?: string | null;
  /** Plugin namespace that owns this skill, if discovered from plugins/<name>/skills/. */
  pluginName?: string | null;
  /** Whether this is a user-global install (`--global`) vs project-local. */
  global: boolean;
  /** ISO timestamp; injected for deterministic tests, defaults to `now`. */
  installedAt?: string;
}

export function buildGitHubInstallLockEntry(
  args: BuildGitHubInstallLockEntryArgs,
): SkillLockEntry {
  const entry: SkillLockEntry = {
    version: args.version,
    sha: args.sha,
    tier: "VERIFIED",
    installedAt: args.installedAt ?? new Date().toISOString(),
    source: `github:${args.owner}/${args.repo}`,
    scope: args.global ? "user" : "project",
    files: ["SKILL.md"],
    sourceType: "github",
    sourceRepoUrl: `https://github.com/${args.owner}/${args.repo}`,
  };
  if (args.sourceSkillPath) {
    entry.sourceSkillPath = args.sourceSkillPath;
  }
  if (args.branch) {
    entry.sourceBranch = args.branch;
  }
  if (args.commitSha) {
    entry.sourceCommitSha = args.commitSha;
  }
  if (args.pluginName) {
    entry.sourcePluginName = args.pluginName;
  }
  return entry;
}
