// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import { searchSkills } from "../api/client.js";
import { bold, green, yellow, dim, cyan, red, link, table } from "../utils/output.js";

interface FindOptions {
  json?: boolean;
  noHint?: boolean;
}

/**
 * Extract owner/repo from a URL and wrap it in a clickable OSC 8 hyperlink.
 * Falls back to author name if no URL is available.
 */
function formatRepo(repoUrl: string | undefined, author: string): string {
  if (!repoUrl) return author || "-";
  try {
    const ownerRepo = new URL(repoUrl).pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .replace(/\/$/, "");
    return link(repoUrl, ownerRepo);
  } catch {
    return repoUrl;
  }
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

  // Sort: non-blocked by score descending, blocked at the end
  results.sort((a, b) => {
    if (a.isBlocked && !b.isBlocked) return 1;
    if (!a.isBlocked && b.isBlocked) return -1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // JSON output mode — no table, no hints
  if (opts?.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const blockedCount = results.filter((r) => r.isBlocked).length;

  const headers = ["Name", "Repository", "Tier", "Score"];
  const rows = results.map((r) => {
    let displayTier: string;
    let tierColor: typeof red;
    let scoreCol: string;

    if (r.isBlocked) {
      displayTier = "BLOCKED";
      tierColor = red;
      // Show severity + threat type as badge in score column
      const parts = [r.severity, r.threatType].filter(Boolean);
      scoreCol = parts.length > 0 ? parts.join(" | ") : "blocked";
    } else if (r.isTainted) {
      displayTier = "TAINTED";
      tierColor = red;
      scoreCol = String(r.score ?? "-");
    } else {
      displayTier = r.tier || "VERIFIED";
      tierColor =
        r.tier === "CERTIFIED"
          ? yellow
          : r.tier === "VERIFIED"
            ? green
            : dim;
      scoreCol = String(r.score ?? "-");
    }

    const repo = formatRepo(r.repoUrl, r.author);
    return [
      r.isBlocked ? red(bold(r.name)) : bold(r.name),
      repo,
      tierColor(displayTier),
      r.isBlocked ? red(scoreCol) : scoreCol,
    ];
  });

  console.log(table(headers, rows));
  console.log(
    dim(`\n${results.length} result${results.length === 1 ? "" : "s"} found`)
  );

  if (blockedCount > 0) {
    console.log(
      red(`\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} — known malicious, installation will be refused`)
    );
  }

  // Install hint — suppress with --json, --no-hint, or when all results are blocked
  const hasInstallable = results.some((r) => !r.isBlocked);
  if (!opts?.noHint && hasInstallable) {
    const firstInstallable = results.find((r) => !r.isBlocked);
    const firstName = firstInstallable?.name ?? "<name>";
    if (process.stdout.isTTY) {
      // Interactive TTY mode
      console.log(dim(`\n↑↓ navigate  i install  q quit`));
    } else {
      // Non-interactive / piped output
      console.log(dim(`\nTo install: npx skills add ${firstName}`));
    }
  }
}
