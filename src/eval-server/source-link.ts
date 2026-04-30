// ---------------------------------------------------------------------------
// source-link.ts -- Source-repo provenance resolver for skill metadata.
//
// Extracted from api-routes.ts as part of 0809 to (a) eliminate circular-
// import risk for studio code that needs the resolver at copy time, and
// (b) give the resolver chain (lockfile -> sidecar -> authored) a focused
// home alongside its helper functions.
//
// Public surface (re-exported from api-routes.ts for backwards compat):
//   - parseGithubRemote
//   - walkUpForGitRoot
//   - detectAuthoredSourceLink     (0770)
//   - readCopiedSkillSidecar       (0809 — new)
//   - resolveSourceLink            (composes the precedence chain)
//   - resetAuthoredSourceLinkCache (test hook)
//   - resetCopiedSkillSidecarCache (test hook — 0809)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename, relative } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";

/**
 * 0770 -- Pure regex parser. Normalizes any github.com origin remote
 * (SSH, HTTPS, ssh://) to its canonical `https://github.com/owner/repo`
 * form (no `.git` suffix, no trailing path). Returns null for non-github
 * hosts, malformed input, empty/whitespace strings.
 */
export function parseGithubRemote(remote: string | null | undefined): string | null {
  const trimmed = (remote ?? "").trim();
  if (!trimmed) return null;
  // SSH: git@github.com:owner/repo[.git]
  let m = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  // ssh://git@github.com/owner/repo[.git]
  m = /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  // http(s)://github.com/owner/repo[.git][/...]
  m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/.exec(trimmed);
  if (m) return `https://github.com/${m[1]}/${m[2]}`;
  return null;
}

/**
 * 0770 -- Walk parent directories from `startDir` looking for a `.git` entry
 * (directory OR file -- git worktrees use a `.git` file). Bails at the
 * filesystem root or after `maxLevels` iterations. Returns the absolute
 * path of the discovered git root, or null.
 */
export function walkUpForGitRoot(startDir: string, maxLevels = 12): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < maxLevels; i++) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

const authoredSourceLinkCache = new Map<string, { repoUrl: string | null; skillPath: string | null }>();

/**
 * 0770 -- Test-only helper to clear the module-level memoization cache so
 * tests can isolate detection runs across `beforeEach`.
 */
export function resetAuthoredSourceLinkCache(): void {
  authoredSourceLinkCache.clear();
}

/**
 * 0770 -- Detect source-repo provenance for a locally-authored skill (no
 * lockfile entry). Walks for `.git`, reads `origin` remote, normalizes via
 * `parseGithubRemote`, and computes `skillPath` from `git ls-files` (with a
 * filesystem fallback for untracked SKILL.md files). Memoized per absolute
 * skill dir for the eval-server process lifetime.
 *
 * All git invocations use `execFileSync` with explicit argv (no shell), a
 * 1500ms hard timeout, and silenced stderr. Any error converts to
 * `{null, null}` -- `buildSkillMetadata` never throws because of git.
 */
export function detectAuthoredSourceLink(
  skillDir: string,
): { repoUrl: string | null; skillPath: string | null } {
  const absDir = resolve(skillDir);
  const cached = authoredSourceLinkCache.get(absDir);
  if (cached) return cached;

  const compute = (): { repoUrl: string | null; skillPath: string | null } => {
    const gitRoot = walkUpForGitRoot(absDir);
    if (!gitRoot) return { repoUrl: null, skillPath: null };

    let remote = "";
    try {
      remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
        cwd: gitRoot,
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }).trim();
    } catch {
      return { repoUrl: null, skillPath: null };
    }

    const repoUrl = parseGithubRemote(remote);
    if (!repoUrl) return { repoUrl: null, skillPath: null };

    let skillPath: string | null = null;
    try {
      const tracked = execFileSync("git", ["ls-files", "--full-name", "SKILL.md"], {
        cwd: absDir,
        timeout: 1500,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
      }).trim();
      if (tracked) skillPath = tracked;
    } catch {
      // fall through to filesystem fallback
    }

    if (!skillPath) {
      // Filesystem fallback for untracked SKILL.md -- same path the file will
      // have on github.com once committed and pushed.
      skillPath = relative(gitRoot, join(absDir, "SKILL.md")).replace(/\\/g, "/");
    }

    return { repoUrl, skillPath };
  };

  const result = compute();
  authoredSourceLinkCache.set(absDir, result);
  return result;
}

// ---------------------------------------------------------------------------
// 0809 -- Copied-skill sidecar reader.
//
// When the Studio scope-transfer (Copy) flow lands a skill into Personal or
// Project scope, it persists the SOURCE skill's resolved {repoUrl, skillPath}
// into a small sidecar file at `<skillDir>/.vskill-source.json`. This reader
// surfaces that snapshot back into resolveSourceLink without bloating
// SKILL.md or touching the lockfile (which is owned by `vskill install`).
//
// Validation is strict: any deviation from the expected shape returns
// {null, null} so the resolver can fall through to the authored detector
// instead of producing a confidently-wrong header anchor.
// ---------------------------------------------------------------------------

const SIDECAR_FILENAME = ".vskill-source.json";
// Canonical form only: no trailing .git, no /tree/, no /blob/, no extra path
// segments. Rejecting .git here forces the writer (transfer()) to persist the
// canonical form so the resolver always returns identical strings whether the
// source was a lockfile install, a sidecar snapshot, or an authored detect.
const REPO_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!.*\.git$)[A-Za-z0-9._-]+$/;

const copiedSkillSidecarCache = new Map<string, { repoUrl: string | null; skillPath: string | null }>();

/**
 * 0809 -- Test-only helper to clear the sidecar memoization cache.
 */
export function resetCopiedSkillSidecarCache(): void {
  copiedSkillSidecarCache.clear();
}

/**
 * 0809 -- Read `<skillDir>/.vskill-source.json` and return the snapshotted
 * {repoUrl, skillPath}. Returns {null, null} on missing file, JSON parse
 * error, missing/invalid `repoUrl`, or non-github host. Memoized per
 * absolute skill dir for the eval-server lifetime.
 */
export function readCopiedSkillSidecar(
  skillDir: string,
): { repoUrl: string | null; skillPath: string | null } {
  const absDir = resolve(skillDir);
  const cached = copiedSkillSidecarCache.get(absDir);
  if (cached) return cached;

  const compute = (): { repoUrl: string | null; skillPath: string | null } => {
    const sidecarPath = join(absDir, SIDECAR_FILENAME);
    if (!existsSync(sidecarPath)) return { repoUrl: null, skillPath: null };

    let raw: string;
    try {
      raw = readFileSync(sidecarPath, "utf-8");
    } catch {
      return { repoUrl: null, skillPath: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { repoUrl: null, skillPath: null };
    }

    if (!parsed || typeof parsed !== "object") return { repoUrl: null, skillPath: null };
    const obj = parsed as Record<string, unknown>;
    const repoUrl = obj.repoUrl;
    if (typeof repoUrl !== "string" || !REPO_URL_RE.test(repoUrl)) {
      return { repoUrl: null, skillPath: null };
    }

    let skillPath: string | null = null;
    if (typeof obj.skillPath === "string" && obj.skillPath.trim() !== "") {
      skillPath = obj.skillPath;
    }

    return { repoUrl, skillPath };
  };

  const result = compute();
  copiedSkillSidecarCache.set(absDir, result);
  return result;
}

/**
 * 0737 -- Resolve the source-repo provenance (repoUrl + skillPath) for a
 * skill. Three precedences:
 *   1. Lockfile receipt with explicit `sourceRepoUrl` (set by recent
 *      `vskill install` after 0737 shipped).
 *   2. Lockfile receipt with legacy `source: github:owner/repo` (every
 *      pre-0737 install -- 0743 derives skillPath safely).
 *   3. (0809, NEW) `.vskill-source.json` sidecar -- written by the Studio
 *      Copy / scope-transfer flow at copy time.
 *   4. (0770) Authored-skill detector -- walks parent `.git` and reads
 *      origin remote.
 *
 * Lockfile entries are keyed by plugin name; for nested-layout plugins the
 * skill dir basename and the lockfile key differ -- fall back to the parent
 * directory's basename when no exact match exists.
 *
 * Sidecar beats authored because the studio's CWD git remote (umbrella's
 * repo) is the wrong source of truth for a skill that was COPIED from
 * elsewhere. Lockfile beats sidecar because an explicit install receipt
 * is more authoritative than a copy-time snapshot.
 */
export function resolveSourceLink(
  skillDir: string,
  root: string,
): { repoUrl: string | null; skillPath: string | null } {
  const lock = readLockfile(root);

  if (lock) {
    const skillName = basename(skillDir);
    const parentName = basename(dirname(skillDir));
    const entry = lock.skills[skillName] ?? lock.skills[parentName];
    if (entry) {
      if (entry.sourceRepoUrl) {
        return {
          repoUrl: entry.sourceRepoUrl,
          skillPath: entry.sourceSkillPath ?? "SKILL.md",
        };
      }

      // Legacy derivation from `source: github:owner/repo`.
      // 0743: We DO NOT blindly default `skillPath` to "SKILL.md" here. Multi-skill
      // repos (vskill, marketingskills, etc.) hold the SKILL.md under a nested
      // path, and the legacy `source` string carries no path information.
      // Guessing "SKILL.md" produced confidently-wrong 404 anchors for every
      // install from a multi-skill repo.
      //
      // 0773 hotfix: when the matched lockfile entry KEY equals the source repo
      // basename (i.e. `vskill install anton-abyzov/greet-anton` keys the entry
      // as `greet-anton` AND the repo is `greet-anton`), the repo IS the skill --
      // SKILL.md sits at the repo root. Defaulting skillPath to "SKILL.md" in
      // that exact shape restores the working SourceFileLink anchor for
      // single-skill repos without re-introducing 404s for multi-skill repos.
      const m = /^github:([^/]+)\/([^/#]+)/.exec(entry.source ?? "");
      // 0770: do NOT fall through here -- an installed skill with a non-github
      // `source` (e.g. `marketplace:...`) is still installed, not authored. Local
      // git detection would leak the workspace remote (umbrella, etc.).
      if (!m) return { repoUrl: null, skillPath: null };
      const repoBasename = m[2];
      const lockKey = lock.skills[skillName] ? skillName : parentName;
      const isSingleSkillRepo = repoBasename === lockKey;
      return {
        repoUrl: `https://github.com/${m[1]}/${m[2]}`,
        skillPath: entry.sourceSkillPath ?? (isSingleSkillRepo ? "SKILL.md" : null),
      };
    }
  }

  // 0809 -- Copied-skill sidecar precedes authored detection so that copies
  // landed via Studio carry the original GitHub source through any
  // intermediate location (e.g. ~/.claude/skills/<name>) -- never the
  // studio CWD's umbrella remote.
  const sidecar = readCopiedSkillSidecar(skillDir);
  if (sidecar.repoUrl) return sidecar;

  return detectAuthoredSourceLink(skillDir);
}
