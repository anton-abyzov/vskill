// ---------------------------------------------------------------------------
// Local git checkout facts for `vskill submit` / `vskill skill publish`:
// which GitHub repo the cwd belongs to, where its SKILL.md files sit, and
// whether the current branch is on GitHub yet. Read-only: every call is a
// `git` query run with an argv array, never a shell string.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface LocalCheckout {
  /** Absolute path of the git working tree root. */
  root: string;
  /** owner/repo parsed from `origin`, or null when origin is missing or not GitHub. */
  owner: string | null;
  repo: string | null;
  /** Raw `origin` URL, or null when the repo has no origin remote. */
  remoteUrl: string | null;
  /** Current branch name, or null on a detached HEAD. */
  branch: string | null;
  /** True when the branch has an upstream that already contains HEAD. */
  pushed: boolean;
  /** True when the branch has an upstream at all. */
  hasUpstream: boolean;
  /**
   * origin's default branch as last seen locally (refs/remotes/origin/HEAD),
   * or null when that ref is not set, e.g. after `git init` + first push.
   */
  defaultBranch: string | null;
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}

/** owner/repo of an https, ssh or scp-style github.com remote URL. */
export function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const m =
    url.trim().match(/^(?:git\+)?(?:https?:\/\/(?:[^@/\s]+@)?|ssh:\/\/git@|git:\/\/)(?:www\.)?github\.com[/:]([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i) ??
    url.trim().match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** The checkout that contains `dir`, or null when `dir` is not inside a git work tree. */
export function readLocalCheckout(dir: string = process.cwd()): LocalCheckout | null {
  const start = existsSync(dir) && !statSync(dir).isDirectory() ? dirname(dir) : dir;
  const root = git(["rev-parse", "--show-toplevel"], start);
  if (!root) return null;
  // The configured URL, not `remote get-url`, which applies insteadOf rewrites.
  const remoteUrl = git(["config", "--get", "remote.origin.url"], root) || null;
  const ref = remoteUrl ? parseGitHubRemote(remoteUrl) : null;
  const rawBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], root);
  const branch = rawBranch && rawBranch !== "HEAD" ? rawBranch : null;
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root);
  const ahead = upstream ? git(["rev-list", "--count", "@{u}..HEAD"], root) : null;
  const originHead = remoteUrl ? git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root) : null;
  const defaultBranch = originHead?.startsWith("origin/") ? originHead.slice("origin/".length) || null : null;
  return {
    root,
    defaultBranch,
    owner: ref?.owner ?? null,
    repo: ref?.repo ?? null,
    remoteUrl,
    branch,
    hasUpstream: Boolean(upstream),
    pushed: Boolean(upstream) && ahead === "0",
  };
}

/** True when `filePath` (repo-relative) exists on origin's `branch` as last fetched or pushed. */
export function isOnOriginBranch(checkout: LocalCheckout, branch: string, filePath: string): boolean {
  return git(["cat-file", "-e", `refs/remotes/origin/${branch}:${filePath}`], checkout.root) !== null;
}

/** True when `filePath` (repo-relative) is committed in the checkout's HEAD. */
export function isCommitted(checkout: LocalCheckout, filePath: string): boolean {
  return git(["cat-file", "-e", `HEAD:${filePath}`], checkout.root) !== null;
}

/** Repo-relative paths of every tracked SKILL.md, POSIX separators. */
export function listTrackedSkillFiles(checkout: LocalCheckout): string[] {
  const out = git(["ls-files", "--", "SKILL.md", "*/SKILL.md"], checkout.root);
  return out ? out.split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

/** Repo-relative POSIX path for an absolute file inside the checkout, or null when outside. */
export function toRepoPath(checkout: LocalCheckout, absPath: string): string | null {
  const rel = relative(checkout.root, absPath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** Frontmatter `name:` of a SKILL.md, falling back to its folder name. */
export function readSkillName(skillMdPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(skillMdPath, "utf8");
  } catch {
    return null;
  }
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const line = fm?.[1].match(/^name:\s*(.+?)\s*$/m);
  const name = line?.[1].replace(/^["']|["']$/g, "").trim();
  if (name) return name;
  const folder = basename(dirname(resolve(skillMdPath)));
  return folder && folder !== "." ? folder : null;
}

/**
 * The SKILL.md a submit run means: `--path` when given (repo-relative, or
 * relative to the cwd), else `SKILL.md` in the cwd. Returns the absolute path
 * when the file exists.
 */
export function locateSkillFile(
  opts: { path?: string; cwd?: string; checkout?: LocalCheckout | null },
): string | null {
  const cwd = opts.cwd ?? process.cwd();
  const candidates: string[] = [];
  if (opts.path) {
    if (isAbsolute(opts.path)) candidates.push(opts.path);
    else {
      if (opts.checkout) candidates.push(join(opts.checkout.root, opts.path));
      candidates.push(resolve(cwd, opts.path));
    }
  } else {
    candidates.push(join(cwd, "SKILL.md"));
  }
  for (const c of candidates) {
    const file = existsSync(c) && statSync(c).isDirectory() ? join(c, "SKILL.md") : c;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return null;
}
