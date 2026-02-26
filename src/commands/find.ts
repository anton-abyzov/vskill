// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import { searchSkills } from "../api/client.js";
import { bold, green, yellow, dim, cyan, red, table } from "../utils/output.js";

interface FindOptions {
  json?: boolean;
  noHint?: boolean;
}

export async function findCommand(query: string, opts?: FindOptions): Promise<void> {
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

  // Sort by score descending (best first)
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // JSON output mode — no table, no hints
  if (opts?.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const headers = ["Name", "Author", "Tier", "Score"];
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
      tierColor(r.tier || "VERIFIED"),
      String(r.score ?? "-"),
    ];
  });

  console.log(table(headers, rows));
  console.log(
    dim(`\n${results.length} result${results.length === 1 ? "" : "s"} found`)
  );

  // Install hint — suppress with --json or --no-hint
  if (!opts?.noHint) {
    const firstName = results[0]?.name ?? "<name>";
    if (process.stdout.isTTY) {
      // Interactive TTY mode
      console.log(dim(`\n↑↓ navigate  i install  q quit`));
    } else {
      // Non-interactive / piped output
      console.log(dim(`\nTo install: npx skills add ${firstName}`));
    }
  }
}
