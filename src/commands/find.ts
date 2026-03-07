// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";
import { searchSkills } from "../api/client.js";
import { bold, dim, cyan, yellow, green, red, link, formatInstalls } from "../utils/output.js";

interface FindOptions {
  json?: boolean;
  noHint?: boolean;
  limit?: number;
}

/**
 * Extract `owner/repo` from a GitHub URL.
 */
function extractBaseRepo(repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/([^/]+\/[^/]+?)(?:\/tree\/|\.git|$)/);
  return match ? match[1] : null;
}

/**
 * Format skill display: `owner/repo@skill-name`.
 * Uses slug fields when available, falls back to extracting from repoUrl/name.
 */
function formatSkillId(r: SkillSearchResult): string {
  const displayName = r.skillSlug || r.name.split("/").pop() || r.name;
  const publisher = r.ownerSlug && r.repoSlug
    ? `${r.ownerSlug}/${r.repoSlug}`
    : extractBaseRepo(r.repoUrl);
  return publisher ? `${publisher}@${displayName}` : displayName;
}

/**
 * Build the verified-skill.com URL for a skill.
 * Uses hierarchical slug fields (owner/repo/skill) when available,
 * falls back to flat name.
 */
function getSkillUrl(r: SkillSearchResult): string {
  if (r.ownerSlug && r.repoSlug && r.skillSlug) {
    return `https://verified-skill.com/skills/${encodeURIComponent(r.ownerSlug)}/${encodeURIComponent(r.repoSlug)}/${encodeURIComponent(r.skillSlug)}`;
  }
  const parts = r.name.split("/");
  if (parts.length === 3) {
    return `https://verified-skill.com/skills/${parts.map(encodeURIComponent).join("/")}`;
  }
  return `https://verified-skill.com/skills/${encodeURIComponent(r.name)}`;
}

/**
 * Return a colored trust badge string based on the trust tier.
 */
function getTrustBadge(trustTier: string | undefined): string {
  switch (trustTier) {
    case "T4": return green("\u2713 certified");
    case "T3": return cyan("\u2713 verified");
    case "T2": return yellow("? maybe");
    case "T1": return dim("? maybe");
    default: return "";
  }
}

export async function findCommand(query: string, opts?: FindOptions): Promise<void> {
  console.log(dim(`Searching for "${query}"...\n`));

  let results: SkillSearchResult[];
  let hasMore = false;
  try {
    const response = await searchSkills(query, { limit: opts?.limit });
    results = response.results;
    hasMore = response.hasMore;
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

  // Sort: non-blocked by vskillInstalls descending, score as tiebreaker, blocked at end
  results.sort((a, b) => {
    if (a.isBlocked && !b.isBlocked) return 1;
    if (!a.isBlocked && b.isBlocked) return -1;
    const installDiff = (b.vskillInstalls ?? 0) - (a.vskillInstalls ?? 0);
    if (installDiff !== 0) return installDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // JSON output mode
  if (opts?.json) {
    const enriched = results.map((r) => ({
      ...r,
      vskillInstalls: r.vskillInstalls ?? 0,
    }));
    console.log(JSON.stringify(enriched, null, 2));
    return;
  }

  const blockedCount = results.filter((r) => r.isBlocked).length;

  // ---------- TTY display: flat two-line entries ----------------------------
  if (process.stdout.isTTY) {
    for (const r of results) {
      const label = formatSkillId(r);
      const url = getSkillUrl(r);

      if (r.isBlocked) {
        const parts = [r.severity, r.threatType].filter(Boolean);
        const threatInfo = parts.length > 0 ? parts.join(" | ") : "blocked";
        console.log(`${red(bold(label))}  ${red("BLOCKED")}  ${red(threatInfo)}`);
      } else {
        const installs = r.vskillInstalls ?? 0;
        const installStr = `${formatInstalls(installs)} installs`;
        const badge = getTrustBadge(r.trustTier);
        console.log(`${bold(label)}  ${dim(installStr)}${badge ? "  " + badge : ""}`);
      }

      console.log(`  ${link(url, cyan(url))}`);
      console.log();
    }

    // Footer
    if (hasMore) {
      console.log(dim(`Use --limit N for more`));
    } else {
      console.log(dim(`${results.length} result${results.length === 1 ? "" : "s"} found.`));
    }

    if (blockedCount > 0) {
      console.log(
        red(
          `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} \u2014 known malicious, installation will be refused`
        )
      );
    }

    // Install hint
    if (!opts?.noHint) {
      const firstInstallable = results.find((r) => !r.isBlocked);
      if (firstInstallable) {
        const repo = extractBaseRepo(firstInstallable.repoUrl);
        if (repo) {
          console.log(dim("\nInstall: ") + cyan(`npx vskill i ${repo}`));
        }
      }
    }

    return;
  }

  // ---------- Non-TTY (piped) — tab-separated flat lines --------------------
  for (const r of results) {
    const name = r.name;
    const repo = extractBaseRepo(r.repoUrl) ?? "";
    if (r.isBlocked) {
      console.log(`${name}\t${repo}\tBLOCKED`);
    } else {
      console.log(`${name}\t${repo}\t${r.vskillInstalls ?? 0}\t${r.trustTier ?? ""}`);
    }
  }

  const pipeCountText = `${results.length} result${results.length === 1 ? "" : "s"} found`;
  console.log(`\n${pipeCountText}${hasMore ? " (more available)" : ""}`);

  if (blockedCount > 0) {
    console.log(
      `\n  ${blockedCount} BLOCKED skill${blockedCount === 1 ? "" : "s"} \u2014 known malicious, installation will be refused`
    );
  }

  if (!opts?.noHint) {
    const firstInstallable = results.find((r) => !r.isBlocked);
    if (firstInstallable) {
      const repo = extractBaseRepo(firstInstallable.repoUrl);
      if (repo) {
        console.log(`\nInstall: npx vskill i ${repo}`);
      }
    }
  }
}
