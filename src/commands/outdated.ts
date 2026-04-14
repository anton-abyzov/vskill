// ---------------------------------------------------------------------------
// vskill outdated -- check installed skills for available updates
// ---------------------------------------------------------------------------

import { checkUpdates } from "../api/client.js";
import type { CheckUpdateItem, CheckUpdateResult } from "../api/client.js";
import { readLockfile, writeLockfile } from "../lockfile/lockfile.js";
import type { VskillLock } from "../lockfile/types.js";
import { parseSource } from "../resolvers/source-resolver.js";
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

export async function outdatedCommand(opts: { json?: boolean }): Promise<void> {
  const lock = readLockfile();

  if (!lock || Object.keys(lock.skills).length === 0) {
    console.log(dim("No skills installed."));
    return;
  }

  // Build the check-updates request
  const items: CheckUpdateItem[] = Object.entries(lock.skills).map(
    ([name, entry]) => ({
      name: resolveFullName(name, entry.source),
      currentVersion: entry.version,
      sha: entry.sha,
    }),
  );

  let results: CheckUpdateResult[];
  try {
    results = await checkUpdates(items);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      console.log(JSON.stringify({ error: msg, results: [] }, null, 2));
    } else {
      console.error(
        red("Failed to check for updates: ") + dim(msg),
      );
    }
    process.exit(1);
  }

  const outdated = results.filter((r) => r.updateAvailable);

  // --json mode: output raw results and exit
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    if (outdated.length > 0) process.exit(1);
    return;
  }

  // Table mode
  if (outdated.length === 0) {
    console.log(green("All skills are up to date."));
    return;
  }

  const headers = ["Skill", "Installed", "Latest", "Bump", "Tier"];
  const rows = outdated.map((r) => {
    const tierColor =
      r.certTier === "CERTIFIED"
        ? yellow
        : r.certTier === "VERIFIED"
          ? green
          : dim;
    return [
      bold(r.name),
      red(r.installed),
      green(r.latest ?? "unknown"),
      r.versionBump ? cyan(r.versionBump) : dim("-"),
      r.certTier ? tierColor(r.certTier) : dim("-"),
    ];
  });

  console.log(bold(`\n${outdated.length} skill(s) have updates available:\n`));
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

