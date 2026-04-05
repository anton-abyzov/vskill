// ---------------------------------------------------------------------------
// vskill versions -- list published versions for a skill
// ---------------------------------------------------------------------------

import { getVersions } from "../api/client.js";
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

export async function versionsCommand(skillName: string): Promise<void> {
  try {
    const resolved = resolveFullName(skillName);
    const versions = await getVersions(resolved);

    if (versions.length === 0) {
      console.log(dim("No versions found for ") + cyan(resolved));
      return;
    }

    console.log(bold(`Versions for ${resolved}\n`));

    const headers = ["Version", "Tier", "Date"];
    const rows = versions.map((v) => {
      const tierColor =
        v.certTier === "CERTIFIED"
          ? yellow
          : v.certTier === "VERIFIED"
            ? green
            : dim;
      return [
        bold(v.version),
        tierColor(v.certTier),
        dim(new Date(v.createdAt).toLocaleDateString()),
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
