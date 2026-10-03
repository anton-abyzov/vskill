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
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import type { SkillLockEntry, VskillLock } from "../lockfile/types.js";
import { parseSource } from "../resolvers/source-resolver.js";
import {
  getRepoVisibility,
  getRepoVisibilityFailure,
  type RepoVisibility,
  type VisibilityFailure,
} from "./repo-visibility.js";

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

// ---------------------------------------------------------------------------
// Remembered public repos. When GitHub rate-limits us or is unreachable, a
// repo confirmed public within the last 30 days still counts as public, so
// its skills keep getting registry checks and updates. Only public repos are
// stored (private repo names never land on disk), and a repo GitHub later
// reports as private or missing is dropped.
// ---------------------------------------------------------------------------

const REMEMBERED_PUBLIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RememberedPublic {
  [ownerRepo: string]: { checkedAt: number };
}

/** Path of the remembered-public file; null when disabled (VSKILL_VISIBILITY_CACHE=0). */
export function visibilityCachePath(): string | null {
  const override = process.env.VSKILL_VISIBILITY_CACHE;
  if (override === "0" || override === "off") return null;
  if (override) return override;
  const dir = process.env.VSKILL_CONFIG_DIR || join(homedir(), ".vskill");
  return join(dir, "repo-visibility.json");
}

function readRemembered(): RememberedPublic {
  const path = visibilityCachePath();
  if (!path) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as { public?: RememberedPublic };
    return data && typeof data.public === "object" && data.public ? data.public : {};
  } catch {
    return {};
  }
}

function writeRemembered(update: (entries: RememberedPublic) => boolean): void {
  const path = visibilityCachePath();
  if (!path) return;
  try {
    const entries = readRemembered();
    if (!update(entries)) return;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ public: entries }, null, 2) + "\n", { mode: 0o600 });
  } catch {
    // Best-effort: the live GitHub answer still decides this run.
  }
}

// Keys already written by this process, so repeated lookups write once.
const rememberedThisRun = new Set<string>();

function rememberVisibility(key: string, visibility: RepoVisibility): void {
  const marker = `${key}:${visibility}`;
  if (rememberedThisRun.has(marker)) return;
  rememberedThisRun.add(marker);
  writeRemembered((entries) => {
    if (visibility === "public") {
      entries[key] = { checkedAt: Date.now() };
      return true;
    }
    if (!(key in entries)) return false;
    delete entries[key];
    return true;
  });
}

function rememberedPublicAt(key: string): number | null {
  const at = readRemembered()[key]?.checkedAt;
  if (typeof at !== "number" || Date.now() - at > REMEMBERED_PUBLIC_TTL_MS) return null;
  return at;
}

// ---------------------------------------------------------------------------
// Repos GitHub could not answer for. Their skills are kept private for this
// run; commands list them so the skip is never silent.
// ---------------------------------------------------------------------------

const unconfirmed = new Map<string, { repo: string; reason: VisibilityFailure }>();
// In-flight lookups, so concurrent checks of one repo share a request.
const inFlight = new Map<string, Promise<RepoVisibility>>();
let unconfirmedWarned = false;
let rememberedWarned = false;

function failureText(reason: VisibilityFailure): string {
  return reason === "rate_limited" ? "GitHub is rate-limiting requests" : "GitHub could not be reached";
}

function warnUnconfirmed(ref: string, reason: VisibilityFailure): void {
  if (unconfirmedWarned) return;
  unconfirmedWarned = true;
  process.stderr.write(
    `vskill: ${failureText(reason)}, so ${ref} could not be confirmed public. ` +
      "Its skills are treated as private this run (no verified-skill.com checks or registry updates). " +
      "Set GITHUB_TOKEN or run `vskill auth login`, then retry.\n",
  );
}

function warnRemembered(ref: string, reason: VisibilityFailure, checkedAt: number): void {
  if (rememberedWarned) return;
  rememberedWarned = true;
  const day = new Date(checkedAt).toISOString().slice(0, 10);
  process.stderr.write(
    `vskill: ${failureText(reason)}; using the visibility of ${ref} last confirmed public on ${day}.\n`,
  );
}

/**
 * Repos whose visibility GitHub could not confirm in this process (rate
 * limit or outage), with the reason. Their skills were treated as private.
 */
export function getUnconfirmedRepos(): Array<{ repo: string; reason: VisibilityFailure }> {
  return [...unconfirmed.values()];
}

/** One line naming the skills that were skipped because GitHub did not answer, or null. */
export function unconfirmedSkipNote(): string | null {
  const repos = getUnconfirmedRepos();
  if (repos.length === 0) return null;
  const reason = repos.some((r) => r.reason === "rate_limited")
    ? "GitHub rate limit"
    : "GitHub unreachable";
  const names = repos.slice(0, 5).map((r) => r.repo).join(", ");
  const more = repos.length > 5 ? ` and ${repos.length - 5} more` : "";
  return (
    `Skipped registry checks for skills from ${repos.length} repo${repos.length === 1 ? "" : "s"} ` +
    `whose visibility could not be confirmed (${reason}): ${names}${more}. ` +
    "Set GITHUB_TOKEN or run `vskill auth login`, then retry."
  );
}

/** @internal test-only */
export function _resetPrivateSourceForTests(): void {
  unconfirmed.clear();
  inFlight.clear();
  rememberedThisRun.clear();
  unconfirmedWarned = false;
  rememberedWarned = false;
}

async function lookUpVisibility(owner: string, repo: string): Promise<RepoVisibility> {
  const ref = `${owner}/${repo}`;
  const key = ref.toLowerCase();
  const known = getRepoVisibility(ref);
  if (known !== "unknown") return known;
  try {
    githubTree ??= import("../discovery/github-tree.js");
    const { getDefaultBranch } = await githubTree;
    await getDefaultBranch(owner, repo);
  } catch {
    // getDefaultBranch never throws today; stay fail-closed if it ever does.
  }
  const live = getRepoVisibility(ref);
  const failure = getRepoVisibilityFailure(ref);
  if (live !== "unknown" || !failure) {
    // A real answer: public, private, or 404 (private or gone).
    rememberVisibility(key, live);
    return live;
  }
  const checkedAt = rememberedPublicAt(key);
  if (checkedAt !== null) {
    warnRemembered(ref, failure, checkedAt);
    return "public";
  }
  unconfirmed.set(key, { repo: ref, reason: failure });
  warnUnconfirmed(ref, failure);
  return "unknown";
}

/**
 * Resolve a GitHub repo's visibility, reusing the process-wide cached
 * `GET /repos/{owner}/{repo}` call. When GitHub rate-limits or is
 * unreachable, a repo confirmed public in the last 30 days still counts as
 * public; otherwise it stays "unknown" (treated as private) and is reported
 * by getUnconfirmedRepos(). Never throws.
 */
export function resolveRepoVisibility(owner: string, repo: string): Promise<RepoVisibility> {
  const key = `${owner}/${repo}`.toLowerCase();
  let pending = inFlight.get(key);
  if (!pending) {
    pending = lookUpVisibility(owner, repo).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** True unless GitHub confirms the repo is public. */
export async function isPrivateOrUnknownRepo(owner: string, repo: string): Promise<boolean> {
  return (await resolveRepoVisibility(owner, repo)) !== "public";
}

/**
 * The GitHub repo behind a local checkout's `origin` remote; null when the
 * directory is not a git checkout, has no remote, or the remote is not GitHub.
 */
export function localDirGitHubRepo(
  dir: string | undefined | null,
  opts: { allowParentCheckout?: boolean } = {},
): GitHubRepoRef | null {
  if (!dir) return null;
  const cwd = resolve(dir);
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 })
      .toString()
      .trim();
  try {
    // Only the directory's own checkout counts. git searches parent folders,
    // so a private plugin copied into a public repo (vendor/, dotfiles)
    // would otherwise inherit that repo's public origin.
    // (A skill authored inside a checkout passes allowParentCheckout: it
    // belongs to that repo.)
    if (!opts.allowParentCheckout && !sameDir(git(["rev-parse", "--show-toplevel"]), cwd)) return null;
    const remote = git(["remote", "get-url", "origin"]);
    // A remote must be a GitHub URL or scp-style address; a bare "a/b" is a
    // local path, not the GitHub repo a/b.
    if (!/[:@]/.test(remote)) return null;
    return parseGitHubRepoRef(remote);
  } catch {
    return null;
  }
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return norm(a) === norm(b);
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
  if (gh) return isPrivateOrUnknownRepo(gh.owner, gh.repo);
  // A local plugin dir without its own GitHub origin, or a source vskill
  // cannot parse, has no confirmed-public origin. Only legacy entries with no
  // source at all (registry-era installs) still count as public.
  if (parsed.type === "local") return true;
  return parsed.type === "unknown" && (entry.source ?? "").trim() !== "";
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
  if (parts.length === 1) {
    // A skill inside a plugin install (keyed by plugin name): match the
    // recorded files, then the key ignoring case.
    const file = `${name}/SKILL.md`;
    const lower = name.toLowerCase();
    for (const [key, entry] of Object.entries(lock.skills)) {
      if (key.toLowerCase() === lower) return entry;
      if (entry.files?.some((f) => f === file || f.endsWith(`/${file}`))) return entry;
    }
    return null;
  }
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
 * True when a skill name the user typed must not be sent to the platform:
 * an installed skill from a private (or unconfirmed) source, or an
 * "owner/repo/skill" name whose repo GitHub does not confirm is public (that
 * covers skills inside private plugins, whose lock entries are keyed by the
 * plugin). A bare name that is not installed is a registry lookup.
 */
export async function isPrivateSkillName(name: string): Promise<boolean> {
  const entry = findInstalledLockEntry(name);
  if (entry) return isPrivateSource(entry);
  const parts = name.split("/");
  if (parts.length === 3 && parts.every(Boolean)) {
    return isPrivateOrUnknownRepo(parts[0], parts[1]);
  }
  return false;
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
