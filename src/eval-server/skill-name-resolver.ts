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
  // Only cache fully-resolved 3-part `owner/repo/skill` forms. Caching the
  // bare-name fallback (a single segment with no slashes) poisons subsequent
  // lookups when the git remote was unreadable on the first call — e.g. a
  // freshly-cloned repo with no `origin` yet, or a transient git timeout.
  // Studio sessions can survive for hours, so a poisoned cache means the
  // Versions tab reports "No published versions yet" forever despite the
  // skill being live on verified-skill.com (0782 hotfix).
  if (value.includes("/")) {
    resolverCache.set(skill, value);
  }
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
 * 0761: Locate a source-tree skill at `<root>/skills/<skill>/SKILL.md`.
 *
 * vskill itself authors skills at this top-level layout (the canonical
 * author-side location), distinct from the plugin-author layout under
 * `<root>/plugins/<plugin>/skills/<skill>`. Without this probe, the resolver falls through
 * to bare-name and the platform proxy mistakenly resolves to a same-named
 * standalone GitHub repo.
 *
 * Security: same isUnsafeSegment guard as `findAuthoredSkillDir`, plus a
 * prefix-containment check against `resolve(<root>, "skills") + sep`.
 */
export async function findAuthoredSourceTreeSkillDir(
  root: string,
  skill: string,
): Promise<string | null> {
  if (isUnsafeSegment(skill)) return null;

  const skillsRoot = resolve(root, "skills");
  const skillsRootPrefix = skillsRoot.endsWith(sep) ? skillsRoot : skillsRoot + sep;
  const skillDir = resolve(skillsRoot, skill);
  if (!skillDir.startsWith(skillsRootPrefix)) return null;

  try {
    const st = await stat(skillDir);
    if (!st.isDirectory()) return null;
    await access(join(skillDir, "SKILL.md"));
    return skillDir;
  } catch {
    return null;
  }
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
 * Decide whether `plugin` is an installed-agent dir (`.claude`, `.cursor`,
 * `.windsurf`, `.codex`, `.openclaw`, `.agent`, `.kiro`, `.gemini`,
 * `.github`, `.aider`, `.copilot`, `.opencode`, `.pi`, ...). The convention
 * is uniform: every supported agent dir starts with `.`.
 *
 * Used by the resolver to pick the right "what is the upstream of this skill"
 * branch: installed-agent views go straight to the lockfile (which records
 * the source the install came from); authoring views run the source-tree
 * probe first so the Studio sees the SAME upstream the author publishes to.
 */
export function isInstalledAgentDirPlugin(plugin: string | null | undefined): boolean {
  return !!plugin && plugin.startsWith(".");
}

/**
 * Resolve a bare skill name to `owner/repo/skill`.
 *
 * 0765: `plugin` is now part of the lookup. When `plugin` identifies an
 * installed-agent dir (e.g. `.claude/scout`), the lockfile-derived upstream
 * wins — the user is looking at a downstream copy whose source is recorded
 * in the lockfile, NOT the same-named source-tree skill in the local repo.
 * For authoring plugins (e.g. `vskill/scout`), the existing 0761 source-tree
 * probe runs first.
 *
 * Cache key is `${plugin}::${skill}` so an installed view of `foo` and an
 * authoring view of `foo` cache independently.
 *
 * Order (authoring view): cache → source-tree → lockfile → authored-skill on
 * disk + git remote → bare-name fallback.
 *
 * Order (installed-agent view): cache → lockfile → bare-name fallback.
 */
export async function resolveSkillApiName(
  skill: string,
  root: string,
  plugin: string | null = null,
): Promise<string> {
  const cacheKey = `${plugin ?? ""}::${skill}`;
  const cached = resolverCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const installedView = isInstalledAgentDirPlugin(plugin);

  // 0761: source-tree skills (`<root>/skills/<skill>`) are the canonical
  // author copy of a vskill-source skill. The repo's own git remote is the
  // correct upstream regardless of any lockfile entry — lockfile entries
  // point at downstream installs (e.g. `.claude/skills/<skill>` populated
  // from a same-named standalone repo). Without this short-circuit, a vskill
  // user with a `github:anton-abyzov/greet-anton` lockfile install (a
  // separate repo) would see the Versions tab proxy to the WRONG upstream
  // and could overwrite the source skill with content from a foreign repo.
  //
  // 0765: skip this probe when the user is looking at an installed copy —
  // the lockfile is then authoritative and the source-tree skill (if any)
  // belongs to a *different* upstream than the install.
  if (!installedView) {
    const sourceDir = await findAuthoredSourceTreeSkillDir(root, skill);
    if (sourceDir) {
      const sourceRemote = await readGitOriginOwnerRepo(sourceDir);
      if (sourceRemote) {
        return rememberAndReturn(cacheKey, `${sourceRemote.owner}/${sourceRemote.repo}/${skill}`);
      }
      return rememberAndReturn(cacheKey, skill);
    }
  }

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
      return rememberAndReturn(cacheKey, `${parsed.owner}/${parsed.repo}/${skill}`);
    }
    return rememberAndReturn(cacheKey, skill);
  }

  const skillDir = await findAuthoredSkillDir(root, skill);
  if (!skillDir) return rememberAndReturn(cacheKey, skill);

  const remote = await readGitOriginOwnerRepo(skillDir);
  if (!remote) return rememberAndReturn(cacheKey, skill);

  return rememberAndReturn(cacheKey, `${remote.owner}/${remote.repo}/${skill}`);
}
