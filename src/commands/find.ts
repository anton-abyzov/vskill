// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";
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

/**
 * Extract the base `owner/repo` slug from a repoUrl.
 * Handles URLs like:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/path
 *   https://github.com/owner/repo.git
 */
function extractBaseRepo(repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/([^/]+\/[^/]+?)(?:\/tree\/|\.git|$)/);
  return match ? match[1] : null;
}

/**
 * Build a display row for a single skill result.
 */
function buildRow(r: SkillSearchResult): string[] {
  let displayTier: string;
  let tierColor: typeof red;
  let scoreCol: string;

  if (r.isBlocked) {
    displayTier = "BLOCKED";
    tierColor = red;
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
}

/**
 * Indent every line of a block of text by a given prefix.
 */
function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
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

  // JSON output mode — no table, no hints, flat array
  if (opts?.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const blockedCount = results.filter((r) => r.isBlocked).length;
  const headers = ["Name", "Repository", "Tier", "Score"];

  // ---------- Grouped TTY display -------------------------------------------
  if (process.stdout.isTTY) {
    // Group results by base repo
    const groupOrder: string[] = [];
    const groups = new Map<string, SkillSearchResult[]>();

    for (const r of results) {
      const base = extractBaseRepo(r.repoUrl) ?? "__ungrouped__";
      if (!groups.has(base)) {
        groups.set(base, []);
        groupOrder.push(base);
      }
      groups.get(base)!.push(r);
    }

    // Separate marketplace groups (2+ skills) from singletons
    const marketplaceKeys = groupOrder.filter(
      (k) => k !== "__ungrouped__" && groups.get(k)!.length >= 2
    );
    const singletonResults: SkillSearchResult[] = [];
    for (const key of groupOrder) {
      const items = groups.get(key)!;
      if (key === "__ungrouped__" || items.length < 2) {
        singletonResults.push(...items);
      }
    }

    const hasMarketplaceGroups = marketplaceKeys.length > 0;

    // Render marketplace groups
    for (const baseRepo of marketplaceKeys) {
      const items = groups.get(baseRepo)!;
      console.log(
        bold(`Plugin Marketplace: ${baseRepo} (${items.length} skills)`) +
          "  " +
          dim(`Install: npx vskill install ${baseRepo}`)
      );
      const rows = items.map((r) => buildRow(r));
      console.log(indent(table(headers, rows), "  "));
      console.log();
    }

    // Render singletons / ungrouped
    if (singletonResults.length > 0) {
      if (hasMarketplaceGroups) {
        console.log(bold("Other results"));
      }
      const rows = singletonResults.map((r) => buildRow(r));
      if (hasMarketplaceGroups) {
        console.log(indent(table(headers, rows), "  "));
      } else {
        console.log(table(headers, rows));
      }
    }

    console.log(
      dim(`\n${results.length} result${results.length === 1 ? "" : "s"} found`)
    );

    if (blockedCount > 0) {
      console.log(
        red(
          `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} — known malicious, installation will be refused`
        )
      );
    }

    // Install hints — show copy-pasteable commands
    const hasInstallable = results.some((r) => !r.isBlocked);
    if (!opts?.noHint && hasInstallable) {
      if (hasMarketplaceGroups) {
        const firstMp = marketplaceKeys[0];
        console.log(dim(`\nInstall marketplace: `) + cyan(`npx vskill i ${firstMp}`));
      } else {
        const firstResult = results.find((r) => !r.isBlocked);
        const repo = firstResult ? extractBaseRepo(firstResult.repoUrl) : null;
        if (repo) {
          console.log(dim(`\nInstall: `) + cyan(`npx vskill i ${repo}`));
        }
      }
    }

    return;
  }

  // ---------- Non-TTY (piped) display — flat table --------------------------
  const rows = results.map((r) => buildRow(r));
  console.log(table(headers, rows));
  console.log(
    dim(`\n${results.length} result${results.length === 1 ? "" : "s"} found`)
  );

  if (blockedCount > 0) {
    console.log(
      red(
        `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} — known malicious, installation will be refused`
      )
    );
  }

  const hasInstallable = results.some((r) => !r.isBlocked);
  if (!opts?.noHint && hasInstallable) {
    const firstInstallable = results.find((r) => !r.isBlocked);
    const firstName = firstInstallable?.name ?? "<name>";
    console.log(dim(`\nTo install: npx skills add ${firstName}`));
  }
}
