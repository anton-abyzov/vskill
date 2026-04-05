// ---------------------------------------------------------------------------
// vskill versions -- list published versions for a skill
// ---------------------------------------------------------------------------

import { getVersions } from "../api/client.js";
import { bold, dim, cyan, red, green, yellow, table } from "../utils/output.js";

export async function versionsCommand(skillName: string): Promise<void> {
  try {
    const versions = await getVersions(skillName);

    if (versions.length === 0) {
      console.log(dim("No versions found for ") + cyan(skillName));
      return;
    }

    console.log(bold(`Versions for ${skillName}\n`));

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
