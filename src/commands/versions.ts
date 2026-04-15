// ---------------------------------------------------------------------------
// vskill versions -- list published versions for a skill
// ---------------------------------------------------------------------------

import { getVersions, getVersionDiff } from "../api/client.js";
import { readLockfile } from "../lockfile/lockfile.js";
import { parseSource } from "../resolvers/source-resolver.js";
import { bold, dim, cyan, red, green, yellow, table } from "../utils/output.js";

/**
 * Resolve a short skill name (e.g. "skill-creator") to its full hierarchical
 * API name (e.g. "anthropics/skills/skill-creator") using the lockfile source.
 * Returns the name unchanged if it already contains slashes or isn't in the lockfile.
 */
function resolveFullName(name: string): string {
  if (name.includes("/")) return name;

  const lock = readLockfile();
  if (!lock) return name;

  const entry = lock.skills[name];
  if (!entry?.source) return name;

  const parsed = parseSource(entry.source);
  if (parsed.type === "github" || parsed.type === "github-plugin" || parsed.type === "marketplace") {
    return `${parsed.owner}/${parsed.repo}/${name}`;
  }

  return name;
}

interface VersionsOptions {
  diff?: boolean;
  from?: string;
  to?: string;
  json?: boolean;
}

export async function versionsCommand(
  skillName: string,
  opts: VersionsOptions,
): Promise<void> {
  try {
    const resolved = resolveFullName(skillName);

    // --diff mode: show unified diff between two versions
    if (opts.diff) {
      await handleDiff(skillName, resolved, opts);
      return;
    }

    const versions = await getVersions(resolved);

    if (versions.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(dim("No versions found for ") + cyan(resolved));
      }
      return;
    }

    // Determine installed version from lockfile
    const lock = readLockfile();
    const lockEntry = lock?.skills[skillName];
    const installedVersion = lockEntry?.version;

    // --json mode
    if (opts.json) {
      const jsonOut = versions.map((v) => ({
        version: v.version,
        certTier: v.certTier,
        createdAt: v.createdAt,
        diffSummary: v.diffSummary ?? null,
        installed: v.version === installedVersion,
      }));
      console.log(JSON.stringify(jsonOut, null, 2));
      return;
    }

    // Table mode
    console.log(bold(`Versions for ${resolved}\n`));

    const headers = ["Version", "Tier", "Date", "Installed", "Changes"];
    const rows = versions.map((v) => {
      const tierColor =
        v.certTier === "CERTIFIED"
          ? yellow
          : v.certTier === "VERIFIED"
            ? green
            : dim;
      const marker = v.version === installedVersion ? "►" : "";
      const summary = truncate(v.diffSummary ?? "", 60);
      return [
        bold(v.version),
        tierColor(v.certTier),
        dim(new Date(v.createdAt).toLocaleDateString()),
        marker ? cyan(marker) : "",
        summary ? dim(summary) : "",
      ];
    });

    console.log(table(headers, rows));
  } catch {
    console.error(
      red(`Skill "${skillName}" not found or has no versions.\n`) +
        dim(`Use ${cyan("vskill find <query>")} to search.`),
    );
    process.exit(1);
  }
}

async function handleDiff(
  skillName: string,
  resolved: string,
  opts: VersionsOptions,
): Promise<void> {
  let fromVersion = opts.from;
  let toVersion = opts.to;

  // If --from/--to not provided, derive from lockfile
  if (!fromVersion || !toVersion) {
    const lock = readLockfile();
    const lockEntry = lock?.skills[skillName];

    if (!lockEntry) {
      console.log(
        dim("Skill not installed. Use --from and --to to compare specific versions."),
      );
      return;
    }

    if (!fromVersion) fromVersion = lockEntry.version;

    // Find latest from versions list
    if (!toVersion) {
      const versions = await getVersions(resolved);
      if (versions.length === 0) {
        console.log(dim("No versions available."));
        return;
      }
      toVersion = versions[0].version;
    }
  }

  const diff = await getVersionDiff(resolved, fromVersion, toVersion);

  console.log(bold(`Diff: ${fromVersion} → ${toVersion}`));
  if (diff.diffSummary) {
    console.log(dim(diff.diffSummary));
  }
  console.log("");

  // Print colorized diff
  for (const line of diff.contentDiff.split("\n")) {
    if (line.startsWith("+")) {
      console.log(green(line));
    } else if (line.startsWith("-")) {
      console.log(red(line));
    } else {
      console.log(line);
    }
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}
