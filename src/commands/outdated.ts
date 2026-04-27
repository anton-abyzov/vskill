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
import type { VskillLock } from "../lockfile/types.js";
import { parseSource } from "../resolvers/source-resolver.js";
import {
  reconcileLockfileVersion,
  resolveInstallPath,
  compareSemver,
  readDiskVersion,
} from "../eval/disk-version.js";
import { readAuthored, removeAuthoredSkill } from "../lockfile/authored.js";
import { bold, dim, green, red, yellow, cyan, table } from "../utils/output.js";

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
 * 0740: Programmatic entry-point for "what's outdated?". Same disk-version
 * reconcile logic as `outdatedCommand`, but returns the data instead of
 * printing/exiting. Lets the eval-server's `/api/skills/updates` route
 * compute updates without shelling out to a separate `vskill` binary on
 * PATH (which may be a different version than the studio is bundling).
 *
 * Returns null when there is no lockfile or no installed skills.
 */
export async function getOutdatedJson(): Promise<
  { results: CheckUpdateResult[]; pinMap: Map<string, string>; authoredNames: Set<string> } | null
> {
  const lock = readLockfile();
  const lockDir = getProjectRoot();
  const authored = readAuthored(lockDir);
  const lockSkillCount = lock ? Object.keys(lock.skills).length : 0;
  if (lockSkillCount === 0 && authored.length === 0) return null;

  const diskVersions = new Map<string, string>();
  const reconcileWarnings = new Map<string, string>();
  const authoredNames = new Set<string>();

  const items: CheckUpdateItem[] = lock
    ? Object.entries(lock.skills).map(([name, entry]) => {
        const resolvedName = resolveFullName(name, entry.source);
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

  const rawResults = await checkUpdates(items);

  const results: CheckUpdateResult[] = rawResults.map((r) => {
    const disk = diskVersions.get(r.name) ?? r.installed;
    const warning = reconcileWarnings.get(r.name);
    let updateAvailable = r.updateAvailable;
    if (updateAvailable && r.latest && compareSemver(disk, r.latest) >= 0) {
      updateAvailable = false;
    }
    return {
      ...r,
      installed: disk,
      updateAvailable,
      ...(warning ? { warning } : {}),
    } as CheckUpdateResult;
  });

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

export async function outdatedCommand(opts: { json?: boolean }): Promise<void> {
  const programmatic = await getOutdatedJson().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, results: [] }, null, 2));
    } else {
      console.error(red("Failed to check for updates: ") + dim(msg));
    }
    process.exit(1);
    return null;
  });

  if (programmatic === null) {
    console.log(dim("No skills installed."));
    return;
  }
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
      green(r.latest ?? "unknown"),
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
  console.log(dim(`\nRun ${cyan("vskill update --all")} to update.\n`));
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

    const otherItems = Object.entries(lock.skills)
      .filter(([name]) => !justInstalledNames.includes(name))
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

