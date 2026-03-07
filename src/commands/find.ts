// ---------------------------------------------------------------------------
// vskill find -- search the verified-skill.com registry
// ---------------------------------------------------------------------------

import type { SkillSearchResult } from "../api/client.js";
import { searchSkills } from "../api/client.js";
import { bold, dim, cyan, yellow, red, link, formatInstalls } from "../utils/output.js";

interface FindOptions {
  json?: boolean;
  noHint?: boolean;
  limit?: number;
}

/**
 * Extract the base `owner/repo` slug from a repoUrl.
 */
function extractBaseRepo(repoUrl: string | undefined): string | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/([^/]+\/[^/]+?)(?:\/tree\/|\.git|$)/);
  return match ? match[1] : null;
}

/**
 * Format as `owner/repo/skill-name`.
 */
function formatRepoSkill(repoUrl: string | undefined, skillName: string): string {
  const base = extractBaseRepo(repoUrl);
  return base ? `${base}/${skillName}` : skillName;
}

/**
 * Build the verified-skill.com URL for a skill.
 * Supports both flat ("social-media-posting") and hierarchical ("owner/repo/skill") names.
 */
function getSkillUrl(skillName: string): string {
  const parts = skillName.split("/");
  if (parts.length === 3) {
    return `https://verified-skill.com/skills/${parts.map(encodeURIComponent).join("/")}`;
  }
  return `https://verified-skill.com/skills/${encodeURIComponent(skillName)}`;
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

  // Sort: non-blocked by stars descending, score as tiebreaker, blocked at end
  results.sort((a, b) => {
    if (a.isBlocked && !b.isBlocked) return 1;
    if (!a.isBlocked && b.isBlocked) return -1;
    const starDiff = (b.githubStars ?? 0) - (a.githubStars ?? 0);
    if (starDiff !== 0) return starDiff;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // JSON output mode
  if (opts?.json) {
    const enriched = results.map((r) => ({
      ...r,
      stars: r.githubStars ?? 0,
    }));
    console.log(JSON.stringify(enriched, null, 2));
    return;
  }

  const blockedCount = results.filter((r) => r.isBlocked).length;

  // ---------- TTY display: flat two-line entries ----------------------------
  if (process.stdout.isTTY) {
    for (const r of results) {
      const label = formatRepoSkill(r.repoUrl, r.name);
      const url = getSkillUrl(r.name);
      const stars = r.githubStars ?? 0;

      if (r.isBlocked) {
        const parts = [r.severity, r.threatType].filter(Boolean);
        const threatInfo = parts.length > 0 ? parts.join(" | ") : "blocked";
        console.log(`${red(bold(label))}  ${red(threatInfo)}`);
      } else {
        const starStr = stars > 0
          ? yellow(bold(`\u2605 ${formatInstalls(stars)}`)) + dim(" GitHub stars")
          : "";
        console.log(`${bold(label)}${starStr ? "  " + starStr : ""}`);
      }

      console.log(`  ${dim("\u2514")} ${link(url, cyan(url))}`);
      console.log();
    }

    // Footer
    if (hasMore) {
      const currentLimit = opts?.limit ?? 10;
      const suggestedLimit = Math.min(currentLimit * 2, 50);
      console.log(dim(`Showing ${results.length} results. Use --limit ${suggestedLimit} for more.`));
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
    const label = formatRepoSkill(r.repoUrl, r.name);
    const stars = r.githubStars ?? 0;
    if (r.isBlocked) {
      console.log(`${label}\tBLOCKED\t${r.threatType ?? ""}`);
    } else {
      console.log(`${label}\t${stars}\t${r.tier}`);
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
