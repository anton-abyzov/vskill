// Hierarchical skill-name resolver for the eval-server.
//
// Why: Studio's Versions tab queries verified-skill.com with `owner/repo/skill`,
// but the eval-server only sees a bare skill segment. Lockfile lookup covers
// installed skills; authored skills (in this repo's plugins/ tree) need a
// git-remote fallback. Failure of any branch silently returns the bare name so
// the proxy's "no VCS surface" empty envelope is preserved.

import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import { parseSource } from "../resolvers/source-resolver.js";

const GIT_TIMEOUT_MS = 5_000;

const GITHUB_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
];

// Single-root assumption: keyed by skill name only. The eval-server runs with a
// single repo root for its lifetime, so callers passing different roots would
// observe stale results. Acceptable for the current design.
//
// Cache stores both successes (`owner/repo/skill`) AND fallbacks (bare name) for
// the eval-server process lifetime. A skill that gains a git remote mid-session
// will still proxy with its bare name until restart — Studio sessions are short
// enough that this is acceptable.
const resolverCache = new Map<string, string>();

/** Test-only: clear the in-process resolver cache between cases. */
export function resetResolverCache(): void {
  resolverCache.clear();
}

function isUnsafeSegment(s: string): boolean {
  return !s || s === "." || s === ".." || s.includes("/") || s.includes("\\");
}

function rememberAndReturn(skill: string, value: string): string {
  resolverCache.set(skill, value);
  return value;
}

/**
 * Parse a GitHub remote URL to `{ owner, repo }`. Returns null for non-GitHub
 * hosts or malformed input. Repo capture accepts dots (e.g. `pages.github.io`)
 * and strips an optional trailing `.git`.
 */
export function parseGitHubRemoteUrl(url: string): { owner: string; repo: string } | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  for (const re of GITHUB_URL_PATTERNS) {
    const m = trimmed.match(re);
    if (!m || !m[1] || !m[2]) continue;
    const repo = m[2].replace(/\/+$/, "");
    if (!repo || repo.includes("/")) continue;
    return { owner: m[1], repo };
  }
  return null;
}

/**
 * Locate an authored skill on disk under `<root>/plugins/<plugin>/skills/<skill>/SKILL.md`.
 * Returns the absolute directory containing SKILL.md, or null if not found.
 * On duplicates across plugins, returns the lexicographically first match.
 *
 * Security: rejects path-separator or `..` segments in `skill`/`plugin` and
 * verifies the resolved dir lives under `<root>/plugins/`.
 */
export async function findAuthoredSkillDir(root: string, skill: string): Promise<string | null> {
  if (isUnsafeSegment(skill)) return null;

  const pluginsDir = resolve(root, "plugins");
  const pluginsRootPrefix = pluginsDir.endsWith(sep) ? pluginsDir : pluginsDir + sep;

  let plugins: string[];
  try {
    plugins = (await readdir(pluginsDir)).sort();
  } catch {
    return null;
  }

  for (const plugin of plugins) {
    if (isUnsafeSegment(plugin)) continue;
    const skillDir = resolve(pluginsDir, plugin, "skills", skill);
    if (!skillDir.startsWith(pluginsRootPrefix)) continue;

    try {
      const st = await stat(skillDir);
      if (!st.isDirectory()) continue;
      await access(join(skillDir, "SKILL.md"));
      return skillDir;
    } catch {
      // missing or unreadable — try next plugin
    }
  }
  return null;
}

/**
 * Run `git -C <dir> config --get remote.origin.url` and parse to owner/repo.
 * Returns null if git is missing, the dir is not a git repo, the remote is
 * absent, or the URL is not a parsable GitHub URL.
 */
export function readGitOriginOwnerRepo(dir: string): Promise<{ owner: string; repo: string } | null> {
  return new Promise((resolveCb) => {
    execFile(
      "git",
      ["-C", dir, "config", "--get", "remote.origin.url"],
      { timeout: GIT_TIMEOUT_MS },
      (err, stdoutOrResult) => {
        if (err) return resolveCb(null);
        // Node typing differs across overloads; normalize to a string body.
        const stdout =
          typeof stdoutOrResult === "string"
            ? stdoutOrResult
            : (stdoutOrResult as { stdout: string } | null)?.stdout ?? "";
        resolveCb(parseGitHubRemoteUrl(stdout.trim()));
      },
    );
  });
}

/**
 * Resolve a bare skill name to `owner/repo/skill`. Order: cache → lockfile →
 * authored-skill on disk + git remote → bare-name fallback. Every outcome is
 * cached so a successful resolution shells out to git at most once per process.
 */
export async function resolveSkillApiName(skill: string, root: string): Promise<string> {
  const cached = resolverCache.get(skill);
  if (cached !== undefined) return cached;

  const lock = readLockfile();
  const entry = lock?.skills?.[skill];
  if (entry?.source) {
    const parsed = parseSource(entry.source);
    if (
      (parsed.type === "github" ||
        parsed.type === "github-plugin" ||
        parsed.type === "marketplace") &&
      parsed.owner &&
      parsed.repo
    ) {
      return rememberAndReturn(skill, `${parsed.owner}/${parsed.repo}/${skill}`);
    }
    return rememberAndReturn(skill, skill);
  }

  const skillDir = await findAuthoredSkillDir(root, skill);
  if (!skillDir) return rememberAndReturn(skill, skill);

  const remote = await readGitOriginOwnerRepo(skillDir);
  if (!remote) return rememberAndReturn(skill, skill);

  return rememberAndReturn(skill, `${remote.owner}/${remote.repo}/${skill}`);
}
