// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import { searchSkills } from "../api/client.js";
import { bold, green, yellow, dim, cyan, red, table } from "../utils/output.js";

export async function findCommand(query: string): Promise<void> {
  console.log(dim(`Searching for "${query}"...\n`));

  let results;
  try {
    const response = await searchSkills(query);
    results = Array.isArray(response) ? response : [];
  } catch (err) {
    console.error(
      red("Failed to search registry: ") +
        dim((err as Error).message)
    );
    process.exit(1);
    return;
  }

  if (results.length === 0) {
    console.log(dim("No skills found matching your query."));
    console.log(
      dim(`Try a broader search or visit ${cyan("https://verified-skill.com")}`)
    );
    return;
  }

  const headers = ["Name", "Author", "Tier", "Score", "Installs"];
  const rows = results.map((r) => {
    const tierColor =
      r.tier === "CERTIFIED"
        ? yellow
        : r.tier === "VERIFIED"
          ? green
          : dim;
    return [
      bold(r.name),
      r.author || "-",
      tierColor(r.tier || "SCANNED"),
      String(r.score ?? "-"),
      String(r.installs ?? 0),
    ];
  });

  console.log(table(headers, rows));
  console.log(
    dim(`\n${results.length} result${results.length === 1 ? "" : "s"} found`)
  );
}
