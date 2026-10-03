// ---------------------------------------------------------------------------
// private-source.ts — the one place that decides whether an installed skill
// may be mentioned to verified-skill.com.
//
// Rule: nothing about a skill from a private GitHub repo (its name, the repo,
// paths, hashes) is sent to the platform. A GitHub-sourced skill whose repo
// visibility is unknown is treated as private: visibility is resolved through
// the cached `GET /repos/{owner}/{repo}` call (getDefaultBranch), and if that
// does not confirm the repo is public (404, no token, rate limit, network
// error) the skill stays local. Registry installs came from the platform, so
// they are always fine to send. A local plugin-dir install counts as public
// only when its checkout's `origin` remote is a GitHub repo confirmed public.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import type { SkillLockEntry, VskillLock } from "../lockfile/types.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { getRepoVisibility, type RepoVisibility } from "./repo-visibility.js";

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/** Parse "owner/repo", "github.com/owner/repo" URLs and git@github.com remotes. */
export function parseGitHubRepoRef(ref: string | undefined | null): GitHubRepoRef | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  const url = trimmed.match(
    /^(?:git\+)?(?:https?:\/\/|ssh:\/\/git@|git:\/\/)(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?(?:[?#].*)?$/i,
  );
  if (url) return { owner: url[1], repo: url[2] };
  const scp = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (scp) return { owner: scp[1], repo: scp[2] };
  // Bare "owner/repo" only — anything with a scheme or host is not GitHub.
  if (/[:@]/.test(trimmed)) return null;
  const bare = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return bare ? { owner: bare[1], repo: bare[2] } : null;
}

// Loaded lazily: the GitHub client pulls in the keychain, which modules that
// only read lockfiles (e.g. the Studio routes) should not load. One shared
// promise so concurrent lookups wait for the same module.
let githubTree: Promise<typeof import("../discovery/github-tree.js")> | null = null;

/**
 * Resolve a GitHub repo's visibility, reusing the process-wide cached
 * `GET /repos/{owner}/{repo}` call. Never throws.
 */
export async function resolveRepoVisibility(owner: string, repo: string): Promise<RepoVisibility> {
  const ref = `${owner}/${repo}`;
  const known = getRepoVisibility(ref);
  if (known !== "unknown") return known;
  try {
    githubTree ??= import("../discovery/github-tree.js");
    const { getDefaultBranch } = await githubTree;
    await getDefaultBranch(owner, repo);
  } catch {
    // getDefaultBranch never throws today; stay fail-closed if it ever does.
  }
  return getRepoVisibility(ref);
}

/** True unless GitHub confirms the repo is public. */
export async function isPrivateOrUnknownRepo(owner: string, repo: string): Promise<boolean> {
  return (await resolveRepoVisibility(owner, repo)) !== "public";
}

/**
 * The GitHub repo behind a local checkout's `origin` remote; null when the
 * directory is not a git checkout, has no remote, or the remote is not GitHub.
 */
export function localDirGitHubRepo(dir: string | undefined | null): GitHubRepoRef | null {
  if (!dir) return null;
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: resolve(dir),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    });
    return parseGitHubRepoRef(out.toString().trim());
  } catch {
    return null;
  }
}

/** The GitHub repo a lock entry was installed from, when it has one. */
export function lockEntryGitHubRepo(entry: SkillLockEntry): GitHubRepoRef | null {
  const parsed = parseSource(entry.source ?? "");
  if (parsed.type === "github" || parsed.type === "github-plugin" || parsed.type === "marketplace") {
    return { owner: parsed.owner, repo: parsed.repo };
  }
  if (parsed.type === "registry" || parsed.type === "local") return null;
  return parseGitHubRepoRef(entry.sourceRepoUrl);
}

/**
 * True when nothing about this installed skill may be sent to the platform.
 * GitHub-sourced entries are checked against GitHub (fail closed).
 */
export async function isPrivateSource(entry: SkillLockEntry | null | undefined): Promise<boolean> {
  if (!entry) return false;
  if (entry.sourcePrivate) return true;
  const parsed = parseSource(entry.source ?? "");
  if (parsed.type === "registry") return false;
  const gh = parsed.type === "local" ? localDirGitHubRepo(parsed.baseName) : lockEntryGitHubRepo(entry);
  // A local plugin dir without a GitHub origin has no confirmed-public source.
  if (!gh && parsed.type === "local") return true;
  if (!gh) return false;
  return isPrivateOrUnknownRepo(gh.owner, gh.repo);
}

/** Lock entries that may be sent to the platform, in their original order. */
export async function filterPublicEntries(
  entries: Array<[string, SkillLockEntry]>,
): Promise<Array<[string, SkillLockEntry]>> {
  const flags = await Promise.all(entries.map(([, entry]) => isPrivateSource(entry)));
  return entries.filter((_, i) => !flags[i]);
}

/**
 * Find the lock entry a user-typed skill name refers to: the lock key itself,
 * or the canonical "owner/repo/skill" form of a GitHub-sourced entry.
 */
export function findLockEntry(
  lock: VskillLock | null | undefined,
  name: string,
): SkillLockEntry | null {
  if (!lock?.skills) return null;
  const direct = lock.skills[name];
  if (direct) return direct;
  const parts = name.split("/");
  if (parts.length !== 3) return null;
  const [owner, repo, skill] = parts;
  const entry = lock.skills[skill];
  if (!entry) return null;
  const gh = lockEntryGitHubRepo(entry);
  if (!gh) return null;
  return gh.owner.toLowerCase() === owner.toLowerCase() && gh.repo.toLowerCase() === repo.toLowerCase()
    ? entry
    : null;
}

/**
 * The lock entry for a skill name the user typed, from the project lockfile
 * or, failing that, the user-global one (`~/.agents/vskill.lock`), so a skill
 * installed with `--global` is recognised from any directory.
 */
export function findInstalledLockEntry(name: string): SkillLockEntry | null {
  const project = findLockEntry(readLockfile(), name);
  if (project) return project;
  try {
    return findLockEntry(readLockfile(join(homedir(), ".agents")), name);
  } catch {
    return null;
  }
}
