// ---------------------------------------------------------------------------
// vskill outdated -- check installed skills for available updates
// ---------------------------------------------------------------------------
// 0740 contract — DISK is the source of truth for `currentVersion`:
//   The lockfile records the version at install time. If the user edits
//   SKILL.md in place, the lockfile drifts. To avoid the bell/toast lying
//   ("installed 1.0.0" while sidebar shows 1.3.0), we resolve each entry's
//   install path and read `metadata.version` from the on-disk SKILL.md.
//   If unreadable we fall back to the lockfile version + a warning. After
//   the platform returns `latest`, we compare semver — if disk >= latest
//   the entry is NOT outdated (don't tell the user to "update" backwards).
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { checkUpdates } from "../api/client.js";
import type { CheckUpdateItem, CheckUpdateResult } from "../api/client.js";
import { readLockfile, writeLockfile } from "../lockfile/lockfile.js";
import { getProjectRoot } from "../lockfile/project-root.js";
import { mergedSkills, resolveLockTargets } from "../lockfile/scope.js";
import type { VskillLock } from "../lockfile/types.js";
import { parseSource } from "../resolvers/source-resolver.js";
import {
  reconcileLockfileVersion,
  resolveInstallPath,
  compareSemver,
  readDiskVersion,
} from "../eval/disk-version.js";
import { readAuthored, removeAuthoredSkill } from "../lockfile/authored.js";
import { filterPublicEntries, unconfirmedSkipNote } from "../lib/private-source.js";
import { bold, dim, green, red, yellow, cyan, table } from "../utils/output.js";
import { computeSha, fetchGitHubSourceSkill } from "../updater/source-fetcher.js";
import type { SkillLockEntry } from "../lockfile/types.js";

const TWENTY_FOUR_HOURS = 86_400_000;

/**
 * Resolve a short skill name to its full hierarchical API name using the
 * lockfile source field. Returns unchanged if already contains slashes.
 */
function resolveFullName(name: string, source: string): string {
  if (name.includes("/")) return name;

  const parsed = parseSource(source);
  if (parsed.type === "github" || parsed.type === "github-plugin" || parsed.type === "marketplace") {
    return `${parsed.owner}/${parsed.repo}/${name}`;
  }

  return name;
}

/**
 * Which lockfile `outdated` reads:
 *   "project" — the project lock only (the Studio route's long-standing view)
 *   "global"  — ~/.agents/vskill.lock plus the legacy ~/vskill.lock
 *   "auto"    — the project lock, or the global one outside a project
 */
export type OutdatedScope = "project" | "global" | "auto";

interface LockView {
  /** null when no lockfile exists for the scope. */
  skills: VskillLock["skills"] | null;
  /** Directory of the lock each entry came from (resolves install paths). */
  dirOf: Map<string, string>;
  /** Where authored (self-published) skills are tracked; null for global. */
  authoredDir: string | null;
  fellBackToGlobal: boolean;
  displayPath: string;
}

function readLockView(scope: OutdatedScope): LockView {
  if (scope === "project") {
    const lock = readLockfile();
    const dir = getProjectRoot();
    const skills = lock ? lock.skills : null;
    return {
      skills,
      dirOf: new Map(Object.keys(skills ?? {}).map((n) => [n, dir])),
      authoredDir: dir,
      fellBackToGlobal: false,
      displayPath: join(dir, "vskill.lock"),
    };
  }
  const r = resolveLockTargets({ global: scope === "global", read: readLockfile });
  const dirOf = new Map<string, string>();
  for (const t of r.targets) for (const n of t.names) if (!dirOf.has(n)) dirOf.set(n, t.dir);
  return {
    skills: r.targets.length > 0 ? mergedSkills(r.targets) : null,
    dirOf,
    authoredDir: scope === "global" ? null : r.projectDir,
    fellBackToGlobal: r.fellBackToGlobal && r.targets.length > 0,
    displayPath: r.displayPath,
  };
}

/**
 * 0740: Programmatic entry-point for "what's outdated?". Same disk-version
 * reconcile logic as `outdatedCommand`, but returns the data instead of
 * printing/exiting. Lets the eval-server's `/api/skills/updates` route
 * compute updates without shelling out to a separate `vskill` binary on
 * PATH (which may be a different version than the studio is bundling).
 *
 * `scope` defaults to "project" so programmatic callers keep their view;
 * the CLI passes "auto" or "global".
 *
 * Returns null when there is no lockfile or no installed skills.
 */
export async function getOutdatedJson(opts: { scope?: OutdatedScope } = {}): Promise<
  { results: CheckUpdateResult[]; pinMap: Map<string, string>; authoredNames: Set<string> } | null
> {
  return outdatedFromView(readLockView(opts.scope ?? "project"));
}

async function outdatedFromView(view: LockView): Promise<
  { results: CheckUpdateResult[]; pinMap: Map<string, string>; authoredNames: Set<string> } | null
> {
  const lock = view.skills ? { skills: view.skills } : null;
  const authoredDir = view.authoredDir;
  const authored = authoredDir ? readAuthored(authoredDir) : [];
  const lockSkillCount = lock ? Object.keys(lock.skills).length : 0;
  if (lockSkillCount === 0 && authored.length === 0) return null;

  const diskVersions = new Map<string, string>();
  const reconcileWarnings = new Map<string, string>();
  const authoredNames = new Set<string>();

  // Private-repo skills (and GitHub skills whose repo is not confirmed
  // public) are never sent to the registry; `vskill update` pulls those from
  // their repos.
  const publicEntries = lock ? await filterPublicEntries(Object.entries(lock.skills)) : [];
  const items: CheckUpdateItem[] = lock
    ? publicEntries.map(([name, entry]) => {
        const resolvedName = resolveFullName(name, entry.source);
        const lockDir = view.dirOf.get(name) ?? authoredDir ?? getProjectRoot();
        const skillMdPath = resolveInstallPath({ name, entry, lockDir });
        const reconciled = reconcileLockfileVersion({
          lockfileVersion: entry.version,
          skillMdPath,
        });
        diskVersions.set(resolvedName, reconciled.version);
        if (reconciled.warning) {
          reconcileWarnings.set(resolvedName, reconciled.warning);
        }
        return {
          name: resolvedName,
          currentVersion: reconciled.version,
          sha: entry.sha,
        };
      })
    : [];

  // 0794 / T-007 — append authored (source-origin) skills to the poll set.
  // Skills the user has published themselves don't appear in vskill.lock
  // (only installs do), so they were silently skipped before. Read disk
  // version from the source SKILL.md and include them in the upstream
  // check. Skip silently if the file disappeared (and clean up tracking)
  // or if the local version cannot be read.
  for (const a of authored) {
    if (lock?.skills[a.name]) {
      // Already tracked via lockfile — avoid duplicate poll entries.
      continue;
    }
    // authored is only non-empty when authoredDir is set.
    const lockDir = authoredDir!;
    const absSourcePath = isAbsolute(a.sourcePath)
      ? a.sourcePath
      : join(lockDir, a.sourcePath);
    if (!existsSync(absSourcePath)) {
      removeAuthoredSkill(lockDir, a.name);
      console.error(
        dim(`${a.name}: source path no longer exists, removed from authored tracking`),
      );
      continue;
    }
    const v = readDiskVersion(absSourcePath);
    if (!v) continue; // never published or unreadable — skip silently (AC-US6-05)
    diskVersions.set(a.name, v);
    items.push({ name: a.name, currentVersion: v });
    authoredNames.add(a.name);
  }

  if (items.length === 0) return null;

  // 0932: GitHub-sourced skills update from their repo, not the registry, so
  // a changed SKILL.md upstream is an update even when the registry (which
  // may lag the repo) reports none. Same comparison `vskill update` makes.
  const [rawResults, sourceChanges] = await Promise.all([
    checkUpdates(items),
    githubSourceChanges(publicEntries),
  ]);

  const results: CheckUpdateResult[] = rawResults.map((r) => {
    const disk = diskVersions.get(r.name) ?? r.installed;
    const warning = reconcileWarnings.get(r.name);
    let updateAvailable = r.updateAvailable;
    if (updateAvailable && r.latest && compareSemver(disk, r.latest) >= 0) {
      updateAvailable = false;
    }
    const change = sourceChanges.get(r.name);
    if (change) sourceChanges.delete(r.name);
    return {
      ...r,
      installed: disk,
      ...(change
        ? { updateAvailable: true, sourceChanged: true, latest: r.updateAvailable ? r.latest : change.version ?? r.latest }
        : { updateAvailable }),
      ...(warning ? { warning } : {}),
    } as CheckUpdateResult;
  });
  // A changed GitHub skill the registry did not answer for.
  for (const [name, change] of sourceChanges) {
    results.push({
      name,
      installed: diskVersions.get(name) ?? change.installed,
      latest: change.version,
      updateAvailable: true,
      sourceChanged: true,
    });
  }

  const pinMap = new Map<string, string>();
  if (lock) {
    for (const [name, entry] of Object.entries(lock.skills)) {
      if (entry.pinnedVersion) {
        pinMap.set(name, entry.pinnedVersion);
        const resolved = resolveFullName(name, entry.source);
        if (resolved !== name) pinMap.set(resolved, entry.pinnedVersion);
      }
    }
  }

  return { results, pinMap, authoredNames };
}

/**
 * 0932: for each unpinned single-skill GitHub entry, read the SKILL.md its
 * repo serves now (raw only, no REST call) and report the ones whose hash
 * differs from the lock's `sha`. Keyed by the full owner/repo/skill name.
 * Read failures are skipped: the registry answer stands.
 */
async function githubSourceChanges(
  entries: Array<[string, SkillLockEntry]>,
): Promise<Map<string, { installed: string; version: string | null }>> {
  const changes = new Map<string, { installed: string; version: string | null }>();
  const candidates = entries.filter(([, e]) => !e.pinnedVersion && e.sha && parseSource(e.source ?? "").type === "github");
  await Promise.all(
    candidates.map(async ([name, entry]) => {
      try {
        const fetched = await fetchGitHubSourceSkill(parseSource(entry.source), name, entry);
        if (!fetched) return;
        // F4: accept the legacy files-map sha too, as `update` does.
        const legacy = fetched.files ? computeSha(fetched.files) : null;
        if (fetched.sha === entry.sha || legacy === entry.sha) return;
        const version = fetched.version && fetched.version !== entry.version ? fetched.version : null;
        changes.set(resolveFullName(name, entry.source), { installed: entry.version, version });
      } catch {
        // Unreadable upstream: no claim either way.
      }
    }),
  );
  return changes;
}

export async function outdatedCommand(opts: { json?: boolean; global?: boolean }): Promise<void> {
  const view = readLockView(opts.global ? "global" : "auto");
  if (view.fellBackToGlobal) {
    // stderr keeps --json output parseable.
    console.error(dim(`No project vskill.lock here; checking user-level skills from ${view.displayPath}`));
  }
  const programmatic = await outdatedFromView(view).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, results: [] }, null, 2));
    } else {
      console.error(red("Failed to check for updates: ") + dim(msg));
    }
    process.exit(1);
    return null;
  });

  const lockEntries = Object.entries(view.skills ?? {});
  const privateCount = lockEntries.length - (await filterPublicEntries(lockEntries)).length;
  const privateNote =
    privateCount > 0
      ? dim(
          `${privateCount} skill${privateCount === 1 ? "" : "s"} from private (or unconfirmed) sources ` +
            "not checked against the registry; `vskill update` pulls them from their repos.",
        )
      : null;
  // Public skills GitHub could not confirm (rate limit, outage) are skipped,
  // never silently: say which and how to fix it. stderr keeps --json clean.
  const skipNote = unconfirmedSkipNote();
  if (skipNote) console.error(yellow(skipNote));

  if (programmatic === null) {
    if (opts.json) {
      console.log("[]");
      if (privateNote) console.error(privateNote);
    } else {
      console.log(privateNote ?? dim("No skills installed."));
    }
    return;
  }
  if (privateNote && !opts.json) console.log(privateNote);
  const { results, pinMap } = programmatic;

  const outdated = results.filter((r) => r.updateAvailable);

  // --json mode: output raw results enriched with pin info and exit
  if (opts.json) {
    const enriched = results.map((r) => ({
      ...r,
      ...(pinMap.has(r.name) ? { pinned: true, pinnedVersion: pinMap.get(r.name) } : {}),
    }));
    console.log(JSON.stringify(enriched, null, 2));
    if (outdated.length > 0) process.exit(1);
    return;
  }

  // Table mode
  if (outdated.length === 0) {
    console.log(green("All skills are up to date."));
    return;
  }

  // Separate pinned and unpinned for count
  const pinnedOutdated = outdated.filter((r) => pinMap.has(r.name));
  const unpinnedOutdated = outdated.filter((r) => !pinMap.has(r.name));

  const headers = ["Skill", "Installed", "Latest", "Bump", "Tier", "Pin"];
  const rows = outdated.map((r) => {
    const tierColor =
      r.certTier === "CERTIFIED"
        ? yellow
        : r.certTier === "VERIFIED"
          ? green
          : dim;
    const pinVersion = pinMap.get(r.name);
    return [
      bold(r.name),
      red(r.installed),
      green(r.latest ?? (r.sourceChanged ? "changed upstream" : "unknown")),
      r.versionBump ? cyan(r.versionBump) : dim("-"),
      r.certTier ? tierColor(r.certTier) : dim("-"),
      pinVersion ? dim(`📌 ${pinVersion}`) : "",
    ];
  });

  const countLabel = pinnedOutdated.length > 0
    ? `${unpinnedOutdated.length} skill(s) have updates available (${pinnedOutdated.length} pinned):`
    : `${outdated.length} skill(s) have updates available:`;

  console.log(bold(`\n${countLabel}\n`));
  console.log(table(headers, rows));
  console.log(dim(`\nRun ${cyan(opts.global || view.fellBackToGlobal ? "vskill update --global" : "vskill update --all")} to update.\n`));
  process.exit(1);
}

/**
 * Post-install hint: check if other installed skills have updates.
 * Throttled to once per 24h. Silently swallows all errors.
 *
 * @param lock - Current lockfile state (may be mutated with lastUpdateCheck)
 * @param lockDir - Directory to write lockfile to
 * @param justInstalledNames - Skill names just installed (excluded from check)
 */
export async function postInstallHint(
  lock: VskillLock,
  lockDir: string,
  justInstalledNames: string[],
): Promise<void> {
  try {
    const allSkillNames = Object.keys(lock.skills);
    if (allSkillNames.length <= 1) return;

    const lastCheck = lock.lastUpdateCheck
      ? new Date(lock.lastUpdateCheck).getTime()
      : 0;
    if (Date.now() - lastCheck < TWENTY_FOUR_HOURS) return;

    const candidates = Object.entries(lock.skills).filter(
      ([name]) => !justInstalledNames.includes(name),
    );
    const otherItems = (await filterPublicEntries(candidates))
      .map(([name, entry]) => ({
        name: resolveFullName(name, entry.source),
        currentVersion: entry.version,
        sha: entry.sha,
      }));

    if (otherItems.length > 0) {
      const updateResults = await checkUpdates(otherItems);
      const outdatedCount = updateResults.filter((r) => r.updateAvailable).length;
      if (outdatedCount > 0) {
        console.log(
          dim(`\n${outdatedCount} skill(s) have updates available. Run \`vskill outdated\` to see them.`),
        );
      }
    }

    lock.lastUpdateCheck = new Date().toISOString();
    writeLockfile(lock, lockDir);
  } catch {
    // Silent — post-install hint must never block or delay install
  }
}

